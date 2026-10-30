import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { formatDateTime, zonedLocalToDate } from "~/lib/datetime";
import { getEventPhase, type EventPhase } from "~/lib/event-phase";
import { normalizeUrl } from "~/lib/url";
import { escapeLike, normalizeForMatch, truncate } from "~/lib/text";
import type { SortKey } from "~/lib/labels";
import type { Database } from "../db";
import {
  categories,
  eventCategories,
  eventContributions,
  events,
  eventSources,
  type Event,
} from "../db/schema";
import {
  EVENT_FIELD_LABEL,
  EVENT_FIELDS,
  type EventField,
  type EventInput,
} from "../validation/event";

export type CategoryRef = { id: number; slug: string; name: string };

export type EventCard = {
  id: string;
  title: string;
  excerpt: string;
  startAt: Date | null;
  endAt: Date | null;
  applicationDeadline: Date | null;
  location: string | null;
  format: Event["format"];
  feeType: Event["feeType"];
  organizer: string | null;
  imageUrl: string | null;
  categories: CategoryRef[];
  phase: EventPhase;
  likeCount: number;
  bookmarkCount: number;
  commentCount: number;
  createdAt: Date;
};

export function mediaUrl(mediaId: string | null | undefined) {
  return mediaId ? `/media/${mediaId}` : null;
}

export async function getActiveCategories(db: Database) {
  return db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder), asc(categories.id));
}

export async function getCategoriesForEvents(db: Database, eventIds: string[]) {
  const map = new Map<string, CategoryRef[]>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select({
      eventId: eventCategories.eventId,
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
    })
    .from(eventCategories)
    .innerJoin(categories, eq(categories.id, eventCategories.categoryId))
    .where(inArray(eventCategories.eventId, eventIds))
    .orderBy(asc(categories.sortOrder));
  for (const { eventId, ...cat } of rows) {
    const list = map.get(eventId) ?? [];
    list.push(cat);
    map.set(eventId, list);
  }
  return map;
}

export function toEventCard(
  e: Event,
  cats: CategoryRef[],
  now: Date,
): EventCard {
  return {
    id: e.id,
    title: e.title,
    excerpt: truncate((e.description ?? "").replace(/\s+/g, " ").trim(), 110),
    startAt: e.startAt,
    endAt: e.endAt,
    applicationDeadline: e.applicationDeadline,
    location: e.location,
    format: e.format,
    feeType: e.feeType,
    organizer: e.organizer,
    imageUrl: mediaUrl(e.imageMediaId),
    categories: cats,
    phase: getEventPhase(e, now),
    likeCount: e.likeCount,
    bookmarkCount: e.bookmarkCount,
    commentCount: e.commentCount,
    createdAt: e.createdAt,
  };
}

export async function toEventCards(db: Database, rows: Event[], now: Date) {
  const cats = await getCategoriesForEvents(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toEventCard(r, cats.get(r.id) ?? [], now));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

export const searchParamsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  category: z.array(z.string().max(50)).max(20).catch([]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  deadline: z.enum(["open", "7d", "30d"]).optional().catch(undefined),
  location: z.string().trim().max(50).optional().catch(undefined),
  format: z.enum(["online", "offline"]).optional().catch(undefined),
  fee: z.enum(["free", "paid"]).optional().catch(undefined),
  audience: z.string().trim().max(50).optional().catch(undefined),
  status: z.enum(["upcoming", "ended", "all"]).catch("upcoming"),
  sort: z.enum(["new", "start", "deadline", "popular"]).catch("start"),
  page: z.coerce.number().int().min(1).max(500).catch(1),
});

export type EventSearchParams = z.infer<typeof searchParamsSchema>;

export function parseSearchParams(sp: URLSearchParams): EventSearchParams {
  const raw: Record<string, unknown> = {};
  for (const key of new Set(sp.keys())) {
    raw[key] = key === "category" ? sp.getAll(key) : sp.get(key) || undefined;
  }
  raw.category ??= [];
  return searchParamsSchema.parse(raw);
}

function like(column: SQL | typeof events.title, term: string) {
  return sql`${column} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`;
}

/** SQL expression: effective end of an event (end, or end of start day). */
const effectiveEnd = sql`coalesce(${events.endAt}, ${events.startAt} + ${DAY - 1})`;

export function notEndedCondition(now: Date) {
  return or(isNull(events.startAt), gte(effectiveEnd, now.getTime()))!;
}

export async function categoryIdsForSlugs(db: Database, slugs: string[]) {
  if (slugs.length === 0) return [];
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.slug, slugs));
  return rows.map((r) => r.id);
}

export async function buildSearchConditions(
  db: Database,
  p: EventSearchParams,
  now: Date,
  timeZone: string,
) {
  const where: SQL[] = [eq(events.status, "published")];

  if (p.q) {
    for (const term of p.q.split(/\s+/).filter(Boolean).slice(0, 5)) {
      where.push(
        or(
          like(events.title, term),
          like(sql`coalesce(${events.description}, '')`, term),
          like(sql`coalesce(${events.organizer}, '')`, term),
          like(sql`coalesce(${events.location}, '')`, term),
        )!,
      );
    }
  }
  if (p.category.length > 0) {
    const ids = await categoryIdsForSlugs(db, p.category);
    if (ids.length === 0) return null;
    where.push(
      inArray(
        events.id,
        db
          .select({ id: eventCategories.eventId })
          .from(eventCategories)
          .where(inArray(eventCategories.categoryId, ids)),
      ),
    );
  }
  if (p.from) {
    const from = zonedLocalToDate(p.from, timeZone);
    if (from) where.push(gte(effectiveEnd, from.getTime()));
  }
  if (p.to) {
    const to = zonedLocalToDate(p.to, timeZone);
    if (to) where.push(lte(events.startAt, new Date(to.getTime() + DAY - 1)));
  }
  if (p.deadline === "open") {
    where.push(
      or(isNull(events.applicationDeadline), gte(events.applicationDeadline, now))!,
    );
  } else if (p.deadline) {
    const days = p.deadline === "7d" ? 7 : 30;
    where.push(gte(events.applicationDeadline, now));
    where.push(lte(events.applicationDeadline, new Date(now.getTime() + days * DAY)));
  }
  if (p.location) where.push(like(sql`coalesce(${events.location}, '')`, p.location));
  if (p.format === "online") where.push(inArray(events.format, ["online", "hybrid"]));
  if (p.format === "offline") where.push(inArray(events.format, ["offline", "hybrid"]));
  if (p.fee) where.push(eq(events.feeType, p.fee));
  if (p.audience)
    where.push(like(sql`coalesce(${events.targetAudience}, '')`, p.audience));

  if (p.status === "upcoming") where.push(notEndedCondition(now));
  if (p.status === "ended") where.push(sql`${effectiveEnd} < ${now.getTime()}`);

  return and(...where)!;
}

export function orderFor(sort: SortKey, now: Date) {
  switch (sort) {
    case "new":
      return [desc(events.createdAt)];
    case "deadline":
      return [
        sql`${events.applicationDeadline} IS NULL`,
        sql`${events.applicationDeadline} < ${now.getTime()}`,
        asc(events.applicationDeadline),
      ];
    case "popular":
      return [
        desc(
          sql`${events.likeCount} + ${events.bookmarkCount} * 2 + ${events.commentCount}`,
        ),
        desc(events.createdAt),
      ];
    case "start":
    default:
      return [sql`${events.startAt} IS NULL`, asc(events.startAt)];
  }
}

export const PAGE_SIZE = 12;

export async function searchEvents(
  db: Database,
  p: EventSearchParams,
  now: Date,
  timeZone: string,
) {
  const where = await buildSearchConditions(db, p, now, timeZone);
  if (!where) return { items: [], total: 0, page: 1, pageCount: 0 };

  const [{ total }] = await db.select({ total: count() }).from(events).where(where);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(p.page, pageCount);
  const rows = await db
    .select()
    .from(events)
    .where(where)
    .orderBy(...orderFor(p.sort, now))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return { items: await toEventCards(db, rows, now), total, page, pageCount };
}

/** Upcoming events for home page sections. */
export async function listEventCards(
  db: Database,
  options: { sort: SortKey; limit: number; now: Date; where?: SQL },
) {
  const conditions = [eq(events.status, "published"), notEndedCondition(options.now)];
  if (options.where) conditions.push(options.where);
  const rows = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(...orderFor(options.sort, options.now))
    .limit(options.limit);
  return toEventCards(db, rows, options.now);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getEvent(db: Database, id: string) {
  return db.query.events.findFirst({ where: eq(events.id, id) });
}

export async function getEventCategoryIds(db: Database, id: string) {
  const rows = await db
    .select({ id: eventCategories.categoryId })
    .from(eventCategories)
    .where(eq(eventCategories.eventId, id));
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

type FieldValues = Pick<EventInput, EventField>;

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date || b instanceof Date) {
    return (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.();
  }
  return (a ?? null) === (b ?? null);
}

function serializable(v: unknown) {
  return v instanceof Date ? v.toISOString() : (v ?? null);
}

function isEmpty(field: EventField, value: unknown) {
  if (value === null || value === undefined || value === "") return true;
  if ((field === "format" || field === "feeType") && value === "unknown") return true;
  return false;
}

function pickFields(input: EventInput): FieldValues {
  return Object.fromEntries(EVENT_FIELDS.map((f) => [f, input[f]])) as FieldValues;
}

async function replaceCategories(db: Database, eventId: string, ids: number[]) {
  const valid = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(inArray(categories.id, ids), eq(categories.isActive, true)));
  await db.delete(eventCategories).where(eq(eventCategories.eventId, eventId));
  if (valid.length > 0) {
    await db
      .insert(eventCategories)
      .values(valid.map((c) => ({ eventId, categoryId: c.id })))
      .onConflictDoNothing();
  }
  return valid.map((c) => c.id);
}

async function addSources(
  db: Database,
  eventId: string,
  userId: string,
  urls: { url: string | null; kind: "official" | "application" | "reference"; fetched?: boolean }[],
) {
  const values = urls
    .filter((u): u is typeof u & { url: string } => !!u.url)
    .map((u) => ({
      id: crypto.randomUUID(),
      eventId,
      url: u.url,
      normalizedUrl: normalizeUrl(u.url)!,
      kind: u.kind,
      addedById: userId,
      fetchedAt: u.fetched ? new Date() : null,
    }))
    .filter((v) => v.normalizedUrl);
  if (values.length > 0) {
    await db.insert(eventSources).values(values).onConflictDoNothing();
  }
}

export async function createEvent(
  db: Database,
  input: EventInput,
  userId: string,
  imageMediaId: string | null,
) {
  const id = crypto.randomUUID();
  const fields = pickFields(input);
  await db.insert(events).values({
    id,
    ...fields,
    imageMediaId,
    createdById: userId,
    normalizedTitle: normalizeForMatch(fields.title),
    normalizedOfficialUrl: normalizeUrl(fields.officialUrl),
  });
  await replaceCategories(db, id, input.categoryIds);
  await addSources(db, id, userId, [
    { url: fields.officialUrl, kind: "official" },
    { url: fields.applicationUrl, kind: "application" },
    { url: input.sourceUrl, kind: "reference", fetched: true },
  ]);
  await db.insert(eventContributions).values({
    id: crypto.randomUUID(),
    eventId: id,
    userId,
    type: "create",
    note: input.sourceUrl ? `URLから取得: ${input.sourceUrl}` : null,
  });
  return id;
}

export type ChangeSet = Record<string, { from: unknown; to: unknown }>;

/** Full edit by the original poster or an administrator. */
export async function updateEvent(
  db: Database,
  existing: Event,
  input: EventInput,
  userId: string,
  options: { imageMediaId: string | null | undefined; asAdmin: boolean },
) {
  const fields = pickFields(input);
  const changes: ChangeSet = {};
  for (const f of EVENT_FIELDS) {
    if (!sameValue(existing[f], fields[f])) {
      changes[f] = { from: serializable(existing[f]), to: serializable(fields[f]) };
    }
  }
  const imageChanged =
    options.imageMediaId !== undefined && options.imageMediaId !== existing.imageMediaId;
  if (imageChanged) changes.image = { from: existing.imageMediaId, to: options.imageMediaId };

  const before = await getEventCategoryIds(db, existing.id);
  const after = await replaceCategories(db, existing.id, input.categoryIds);
  if (before.sort().join() !== [...after].sort().join()) {
    changes.categories = { from: before, to: after };
  }

  if (Object.keys(changes).length === 0) return changes;

  await db
    .update(events)
    .set({
      ...fields,
      ...(imageChanged ? { imageMediaId: options.imageMediaId } : {}),
      normalizedTitle: normalizeForMatch(fields.title),
      normalizedOfficialUrl: normalizeUrl(fields.officialUrl),
      updatedAt: new Date(),
    })
    .where(eq(events.id, existing.id));
  await addSources(db, existing.id, userId, [
    { url: fields.officialUrl, kind: "official" },
    { url: fields.applicationUrl, kind: "application" },
  ]);
  await db.insert(eventContributions).values({
    id: crypto.randomUUID(),
    eventId: existing.id,
    userId,
    type: options.asAdmin && existing.createdById !== userId ? "moderate" : "edit",
    changes,
  });
  return changes;
}

/**
 * Information added by another student. Only fills fields that are still
 * empty; differing values are kept as suggestions in the history so that the
 * poster / an administrator can review them.
 */
export async function addInfoToEvent(
  db: Database,
  existing: Event,
  input: EventInput,
  userId: string,
  options: { imageMediaId: string | null; note?: string | null; timeZone: string },
) {
  const fields = pickFields(input);
  const updates: Partial<FieldValues> = {};
  const changes: ChangeSet = {};
  const suggestions: string[] = [];

  for (const f of EVENT_FIELDS) {
    const current = existing[f];
    const proposed = fields[f];
    if (isEmpty(f, proposed) || sameValue(current, proposed)) continue;
    if (
      typeof current === "string" &&
      typeof proposed === "string" &&
      normalizeForMatch(current) === normalizeForMatch(proposed)
    )
      continue;
    if (isEmpty(f, current)) {
      (updates as Record<string, unknown>)[f] = proposed;
      changes[f] = { from: serializable(current), to: serializable(proposed) };
    } else {
      const shown =
        proposed instanceof Date ? formatDateTime(proposed, options.timeZone) : String(proposed);
      suggestions.push(`${EVENT_FIELD_LABEL[f]}: ${shown}`);
    }
  }
  if (!existing.imageMediaId && options.imageMediaId) {
    changes.image = { from: null, to: options.imageMediaId };
  }

  const before = await getEventCategoryIds(db, existing.id);
  const added = input.categoryIds.filter((id) => !before.includes(id));
  if (added.length > 0) {
    const after = await replaceCategories(db, existing.id, [...before, ...added].slice(0, 8));
    changes.categories = { from: before, to: after };
  }

  if (Object.keys(updates).length > 0 || changes.image) {
    await db
      .update(events)
      .set({
        ...updates,
        ...(changes.image ? { imageMediaId: options.imageMediaId } : {}),
        ...(updates.officialUrl
          ? { normalizedOfficialUrl: normalizeUrl(updates.officialUrl) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(events.id, existing.id));
  }
  await addSources(db, existing.id, userId, [
    { url: fields.officialUrl, kind: "official" },
    { url: fields.applicationUrl, kind: "application" },
    { url: input.sourceUrl, kind: "reference", fetched: true },
  ]);

  const note = [
    options.note,
    suggestions.length > 0 ? `異なる値の提案: ${suggestions.join(" / ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await db.insert(eventContributions).values({
    id: crypto.randomUUID(),
    eventId: existing.id,
    userId,
    type: "add_info",
    changes: Object.keys(changes).length > 0 ? changes : null,
    note: note || null,
  });

  return { changes, suggestions };
}
