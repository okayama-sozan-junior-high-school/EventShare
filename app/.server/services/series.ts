import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { editionLabelFrom } from "~/lib/edition";
import { seriesStats } from "~/lib/series-stats";
import { escapeLike } from "~/lib/text";
import { hostnameOf } from "~/lib/url";
import { getEventPhase } from "~/lib/event-phase";
import { getConfig } from "../config";
import type { Database } from "../db";
import { chunkForD1 } from "../db/utils";
import {
  eventBookmarks,
  eventContributions,
  eventParticipations,
  eventSeries,
  events,
  seriesWatches,
  type Event,
} from "../db/schema";
import { notify } from "./notifications";
import {
  classifySeriesCandidates,
  displaySeriesTitle,
  seriesMatchKey,
  type SeriesCandidateInput,
  type SeriesCandidateRow,
} from "../series/classify";

export { displaySeriesTitle, seriesMatchKey };

const THREE_YEARS_MS = 3 * 365.25 * 86_400_000;

/** Creates a new single-edition series for an event and returns its id. */
export async function ensureSeriesFor(db: Database, input: { title: string; userId: string | null }) {
  const id = crypto.randomUUID();
  const title = displaySeriesTitle(input.title);
  await db.insert(eventSeries).values({
    id,
    title,
    matchKey: seriesMatchKey(title),
    createdById: input.userId,
  });
  return id;
}

/**
 * Rewrites a series title / match_key from `stripEditionMarkers` (backfilled
 * rows still store the raw title). Returns null when the series does not exist.
 */
export async function adoptSeries(db: Database, seriesId: string) {
  const series = await db.query.eventSeries.findFirst({ where: eq(eventSeries.id, seriesId) });
  if (!series) return null;
  const title = displaySeriesTitle(series.title);
  const matchKey = seriesMatchKey(title);
  if (title !== series.title || matchKey !== series.matchKey) {
    await db.update(eventSeries).set({ title, matchKey, updatedAt: new Date() }).where(eq(eventSeries.id, seriesId));
  }
  return seriesId;
}

function oldestFirst(a: { startAt: Date | null; id: string }, b: { startAt: Date | null; id: string }) {
  if (a.startAt && b.startAt && a.startAt.getTime() !== b.startAt.getTime()) {
    return a.startAt.getTime() - b.startAt.getTime();
  }
  if (a.startAt && !b.startAt) return -1;
  if (!a.startAt && b.startAt) return 1;
  return a.id.localeCompare(b.id);
}

function newestFirst(a: { startAt: Date | null; id: string }, b: { startAt: Date | null; id: string }) {
  if (a.startAt && b.startAt && a.startAt.getTime() !== b.startAt.getTime()) {
    return b.startAt.getTime() - a.startAt.getTime();
  }
  if (a.startAt && !b.startAt) return -1;
  if (!a.startAt && b.startAt) return 1;
  return a.id.localeCompare(b.id);
}

export function pickLatestEdition<T extends { id: string; status: string; startAt: Date | null }>(editions: T[]) {
  const published = editions.filter((e) => e.status === "published");
  const pool = published.length > 0 ? published : editions.filter((e) => e.status !== "merged");
  return [...pool].sort(newestFirst)[0] ?? null;
}

export async function getSeriesDetail(db: Database, id: string, userId: string | null, timeZone: string) {
  const series = await db.query.eventSeries.findFirst({ where: eq(eventSeries.id, id) });
  if (!series) return null;

  const [editions, watch] = await Promise.all([
    db.select().from(events).where(eq(events.seriesId, id)),
    userId
      ? db.query.seriesWatches.findFirst({
          where: and(eq(seriesWatches.userId, userId), eq(seriesWatches.seriesId, id)),
        })
      : Promise.resolve(null),
  ]);

  const ordered = [...editions].sort(oldestFirst);
  const stats = seriesStats(ordered, timeZone);
  const now = new Date();

  return {
    id: series.id,
    title: series.title,
    displayTitle: displaySeriesTitle(series.title),
    description: series.description,
    watchCount: series.watchCount,
    watching: !!watch,
    editionCount: ordered.filter((e) => e.status !== "merged").length,
    stats: {
      count: stats.count,
      cadence: stats.cadence,
      typicalStartMonth: stats.typicalStartMonth,
      typicalDeadlineMonth: stats.typicalDeadlineMonth,
      recurringSoon: stats.isRecurringSoon(now),
    },
    editions: ordered,
  };
}

export type SeriesDetail = NonNullable<Awaited<ReturnType<typeof getSeriesDetail>>>;

async function publishedCounts(db: Database, seriesIds: string[]) {
  const map = new Map<string, number>();
  if (seriesIds.length === 0) return map;
  const rows = await db
    .select({ seriesId: events.seriesId, n: count() })
    .from(events)
    .where(and(inArray(events.seriesId, seriesIds), eq(events.status, "published")))
    .groupBy(events.seriesId);
  for (const row of rows) {
    if (row.seriesId) map.set(row.seriesId, Number(row.n));
  }
  return map;
}

const candidateColumns = {
  seriesId: eventSeries.id,
  seriesTitle: eventSeries.title,
  matchKey: eventSeries.matchKey,
  eventId: events.id,
  eventTitle: events.title,
  normalizedTitle: events.normalizedTitle,
  organizer: events.organizer,
  officialUrl: events.officialUrl,
};

function hostMatchSql(host: string): SQL {
  const prefix = `${escapeLike(host)}/%`;
  const port = `${escapeLike(host)}:%`;
  return sql`(
    ${events.normalizedOfficialUrl} = ${host}
    OR ${events.normalizedOfficialUrl} LIKE ${prefix} ESCAPE '\\'
    OR ${events.normalizedOfficialUrl} LIKE ${port} ESCAPE '\\'
  )`;
}

async function selectCandidateRows(db: Database, where: SQL, limit: number) {
  return db
    .select(candidateColumns)
    .from(events)
    .innerJoin(eventSeries, eq(eventSeries.id, events.seriesId))
    .where(where)
    .orderBy(desc(events.startAt))
    .limit(limit);
}

/**
 * Strong = exact match key plus organizer or URL host. Weak = key-only or
 * Dice ≥ 0.8. Also scores each edition title, so backfilled series (match_key
 * still includes the year) are found via `events.normalized_title`.
 */
export async function findSeriesCandidates(db: Database, input: SeriesCandidateInput) {
  const inputKey = seriesMatchKey(input.title);
  const since = new Date(Date.now() - THREE_YEARS_MS);
  const scope: SQL[] = [eq(events.status, "published")];
  if (input.excludeEventId) scope.push(ne(events.id, input.excludeEventId));
  const base = and(...scope)!;

  const priority: SQL[] = [eq(eventSeries.matchKey, inputKey)];
  const hostname = hostnameOf(input.sourceUrl);
  if (hostname) priority.push(hostMatchSql(hostname));
  if (input.organizer?.trim()) priority.push(eq(events.organizer, input.organizer.trim()));

  const [priorityRows, recentRows] = await Promise.all([
    selectCandidateRows(db, and(base, or(...priority))!, 200),
    selectCandidateRows(db, and(base, or(gte(events.startAt, since), isNull(events.startAt)))!, 500),
  ]);

  const merged = new Map<string, SeriesCandidateRow>();
  for (const row of [...priorityRows, ...recentRows]) {
    if (!merged.has(row.eventId) && merged.size < 500) merged.set(row.eventId, row);
  }

  const classified = classifySeriesCandidates(input, [...merged.values()]);
  const ids = [classified.strong?.seriesId, ...classified.weak.map((c) => c.seriesId)].filter(
    (id): id is string => !!id,
  );
  const counts = await publishedCounts(db, ids);
  const present = (c: (typeof classified.weak)[number]) => ({
    ...c,
    title: displaySeriesTitle(c.title),
    count: counts.get(c.seriesId) ?? 0,
  });

  return {
    strong: classified.strong ? present(classified.strong) : null,
    weak: classified.weak.map(present),
  };
}

export type SeriesCandidate = Awaited<ReturnType<typeof findSeriesCandidates>>["weak"][number];

export function seriesLinkPermissions(input: {
  userId: string;
  ownerId: string | null;
  admin: boolean;
  /** Non-merged editions currently in the series, including this event. */
  editionCount: number;
}) {
  const manager = input.admin || input.userId === input.ownerId;
  return {
    attach: manager || input.editionCount <= 1,
    detach: manager,
  };
}

/**
 * Moves watchers off `from` and deletes it, but only when it has no editions
 * left. Statements are meant to run after the edition has already been moved.
 */
function moveEmptySeries(db: Database, from: string, to: string) {
  const fromIsEmpty = notExists(db.select({ id: events.id }).from(events).where(eq(events.seriesId, from)));
  return [
    db
      .delete(seriesWatches)
      .where(
        and(
          eq(seriesWatches.seriesId, from),
          fromIsEmpty,
          inArray(
            seriesWatches.userId,
            db.select({ id: seriesWatches.userId }).from(seriesWatches).where(eq(seriesWatches.seriesId, to)),
          ),
        ),
      ),
    db
      .update(seriesWatches)
      .set({ seriesId: to })
      .where(and(eq(seriesWatches.seriesId, from), fromIsEmpty)),
    db.delete(eventSeries).where(and(eq(eventSeries.id, from), fromIsEmpty)),
    db
      .update(eventSeries)
      .set({
        watchCount: sql`(select count(*) from ${seriesWatches} where ${seriesWatches.seriesId} = ${to})`,
      })
      .where(eq(eventSeries.id, to)),
  ] as const;
}

async function runBatch(db: Database, statements: BatchItem<"sqlite">[]) {
  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

function contributionType(event: Event, userId: string, asAdmin: boolean) {
  if (event.createdById === userId) return "edit" as const;
  if (asAdmin) return "moderate" as const;
  return "add_info" as const;
}

export async function attachToSeries(
  db: Database,
  input: { eventId: string; seriesId: string; userId: string; asAdmin?: boolean },
) {
  const [event, series] = await Promise.all([
    db.query.events.findFirst({ where: eq(events.id, input.eventId) }),
    db.query.eventSeries.findFirst({ where: eq(eventSeries.id, input.seriesId) }),
  ]);
  if (!event || event.status === "merged" || !series) return { ok: false as const, error: "not_found" as const };
  if (event.seriesId === series.id) return { ok: true as const, changed: false as const };

  const { timeZone } = getConfig();
  const editionLabel = event.editionLabel?.trim()
    ? event.editionLabel
    : editionLabelFrom(event.title, event.startAt, timeZone);
  const title = displaySeriesTitle(series.title);
  const oldSeriesId = event.seriesId;

  const statements: BatchItem<"sqlite">[] = [
    db
      .update(events)
      .set({ seriesId: series.id, editionLabel, updatedAt: new Date() })
      .where(eq(events.id, event.id)),
    db
      .update(eventSeries)
      .set({ title, matchKey: seriesMatchKey(title), updatedAt: new Date() })
      .where(eq(eventSeries.id, series.id)),
    db.insert(eventContributions).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      userId: input.userId,
      type: contributionType(event, input.userId, !!input.asAdmin),
      changes: { series: { from: oldSeriesId, to: series.id } },
    }),
  ];
  if (oldSeriesId && oldSeriesId !== series.id) {
    statements.push(...moveEmptySeries(db, oldSeriesId, series.id));
  }
  await runBatch(db, statements);
  return { ok: true as const, changed: true as const, seriesId: series.id };
}

export async function detachToNewSeries(
  db: Database,
  input: { eventId: string; userId: string; asAdmin?: boolean },
) {
  const event = await db.query.events.findFirst({ where: eq(events.id, input.eventId) });
  if (!event || event.status === "merged") return { ok: false as const, error: "not_found" as const };

  const newId = crypto.randomUUID();
  const title = displaySeriesTitle(event.title);
  const oldSeriesId = event.seriesId;
  const statements: BatchItem<"sqlite">[] = [
    db.insert(eventSeries).values({
      id: newId,
      title,
      matchKey: seriesMatchKey(title),
      createdById: input.userId,
    }),
    db.update(events).set({ seriesId: newId, updatedAt: new Date() }).where(eq(events.id, event.id)),
    db.insert(eventContributions).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      userId: input.userId,
      type: contributionType(event, input.userId, !!input.asAdmin),
      changes: { series: { from: oldSeriesId, to: newId } },
    }),
  ];
  if (oldSeriesId && oldSeriesId !== newId) statements.push(...moveEmptySeries(db, oldSeriesId, newId));
  await runBatch(db, statements);
  return { ok: true as const, seriesId: newId };
}

function recountWatches(db: Database, seriesId: string) {
  return db
    .update(eventSeries)
    .set({
      watchCount: sql`(select count(*) from ${seriesWatches} where ${seriesWatches.seriesId} = ${seriesId})`,
    })
    .where(eq(eventSeries.id, seriesId));
}

export async function watchSeries(db: Database, userId: string, seriesId: string) {
  const series = await db.query.eventSeries.findFirst({ where: eq(eventSeries.id, seriesId) });
  if (!series) return false;
  await runBatch(db, [
    db.insert(seriesWatches).values({ userId, seriesId }).onConflictDoNothing(),
    recountWatches(db, seriesId),
  ]);
  return true;
}

export async function unwatchSeries(db: Database, userId: string, seriesId: string) {
  const series = await db.query.eventSeries.findFirst({ where: eq(eventSeries.id, seriesId) });
  if (!series) return false;
  await runBatch(db, [
    db
      .delete(seriesWatches)
      .where(and(eq(seriesWatches.userId, userId), eq(seriesWatches.seriesId, seriesId))),
    recountWatches(db, seriesId),
  ]);
  return true;
}

export async function listWatchedSeries(db: Database, userId: string) {
  const rows = await db
    .select({ id: eventSeries.id, title: eventSeries.title })
    .from(seriesWatches)
    .innerJoin(eventSeries, eq(eventSeries.id, seriesWatches.seriesId))
    .where(eq(seriesWatches.userId, userId))
    .orderBy(desc(seriesWatches.createdAt))
    .limit(20);
  const counts = await publishedCounts(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    title: displaySeriesTitle(r.title),
    count: counts.get(r.id) ?? 0,
  }));
}

export async function searchSeries(db: Database, q: string, excludeSeriesId?: string | null) {
  const term = q.trim();
  if (term.length < 2) return [];
  const pattern = `%${escapeLike(term.slice(0, 80))}%`;
  const filters = [sql`${eventSeries.title} LIKE ${pattern} ESCAPE '\\'`];
  if (excludeSeriesId) filters.push(ne(eventSeries.id, excludeSeriesId));
  const rows = await db
    .select({ id: eventSeries.id, title: eventSeries.title })
    .from(eventSeries)
    .where(and(...filters))
    .orderBy(asc(eventSeries.title))
    .limit(8);
  const counts = await publishedCounts(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    title: displaySeriesTitle(r.title),
    count: counts.get(r.id) ?? 0,
  }));
}

async function userIdsFor(eventIds: string[], load: (ids: string[]) => Promise<{ userId: string }[]>) {
  const ids = new Set<string>();
  for (const chunk of chunkForD1(eventIds, 1)) {
    for (const row of await load(chunk)) ids.add(row.userId);
  }
  return ids;
}

export async function getEventSeriesContext(
  db: Database,
  event: Event,
  viewer: { id: string; admin: boolean } | null,
  timeZone: string,
) {
  if (!event.seriesId) return null;
  const detail = await getSeriesDetail(db, event.seriesId, viewer?.id ?? null, timeZone);
  if (!detail) return null;

  const visible = detail.editions.filter((edition) => {
    if (edition.status === "merged") return false;
    if (edition.status === "published") return true;
    return !!viewer && (viewer.admin || edition.createdById === viewer.id);
  });
  const ordered = [...visible].sort(oldestFirst);
  const index = ordered.findIndex((edition) => edition.id === event.id);
  const linkOf = (edition: Event | undefined) =>
    edition
      ? { id: edition.id, title: edition.title, editionLabel: edition.editionLabel }
      : null;

  const siblings = detail.editions.filter((edition) => edition.id !== event.id && edition.status !== "merged");
  const canReview = !!viewer && (viewer.admin || viewer.id === event.createdById);
  const found =
    canReview && siblings.length === 0
      ? await findSeriesCandidates(db, {
          title: event.title,
          organizer: event.organizer,
          sourceUrl: event.officialUrl,
          excludeEventId: event.id,
        })
      : null;
  // Strong matches are attached at post time. If the poster later detaches,
  // surface that series here so it can be linked again.
  const candidates = found ? [...(found.strong ? [found.strong] : []), ...found.weak] : [];

  const perms = viewer
    ? seriesLinkPermissions({
        userId: viewer.id,
        ownerId: event.createdById,
        admin: viewer.admin,
        editionCount: detail.editionCount,
      })
    : { attach: false, detach: false };

  return {
    id: detail.id,
    title: detail.displayTitle,
    count: detail.stats.count,
    editionCount: detail.editionCount,
    editionLabel: event.editionLabel,
    previous: index > 0 ? linkOf(ordered[index - 1]) : null,
    next: index >= 0 && index < ordered.length - 1 ? linkOf(ordered[index + 1]) : null,
    candidates,
    watching: detail.watching,
    canAttach: perms.attach,
    canDetach: perms.detach,
  };
}

/**
 * Notifies series watchers and people who bookmarked or joined another
 * edition. Skips the poster, drafts, ended events, and series with no other
 * published edition. Respects the `new_edition` setting via `notify`.
 * Returns the user ids that were notified.
 */
export async function notifyNewEdition(db: Database, input: { seriesId: string; newEventId: string }) {
  const event = await db.query.events.findFirst({ where: eq(events.id, input.newEventId) });
  if (!event || event.status !== "published" || event.seriesId !== input.seriesId) return [];
  const { timeZone } = getConfig();
  if (getEventPhase(event, new Date()) === "ended") return [];

  const siblings = await db
    .select({ id: events.id, status: events.status })
    .from(events)
    .where(and(eq(events.seriesId, input.seriesId), ne(events.id, event.id), ne(events.status, "merged")));
  if (!siblings.some((s) => s.status === "published")) return [];

  const series = await db.query.eventSeries.findFirst({ where: eq(eventSeries.id, input.seriesId) });
  if (!series) return [];

  const siblingIds = siblings.map((s) => s.id);
  const [watchers, bookmarked, participated] = await Promise.all([
    db.select({ userId: seriesWatches.userId }).from(seriesWatches).where(eq(seriesWatches.seriesId, series.id)),
    userIdsFor(siblingIds, (ids) =>
      db.select({ userId: eventBookmarks.userId }).from(eventBookmarks).where(inArray(eventBookmarks.eventId, ids)),
    ),
    userIdsFor(siblingIds, (ids) =>
      db
        .select({ userId: eventParticipations.userId })
        .from(eventParticipations)
        .where(inArray(eventParticipations.eventId, ids)),
    ),
  ]);

  const poster = event.createdById;
  const recipients = [
    ...new Set([...watchers.map((w) => w.userId), ...bookmarked, ...participated]),
  ].filter((id) => id !== poster);

  return notify(db, recipients, {
    type: "new_edition",
    title: `「${displaySeriesTitle(series.title)}」の新しい回が登録されました`,
    body: event.title,
    link: `/events/${event.id}`,
    eventId: event.id,
    actorId: poster,
    dedupeKey: (userId) => `new_edition:${series.id}:${event.id}:${userId}`,
  });
}
