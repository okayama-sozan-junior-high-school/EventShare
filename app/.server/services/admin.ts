import { and, count, desc, eq, gte, inArray, notExists, or, sql } from "drizzle-orm";
import { escapeLike } from "~/lib/text";
import type { Database } from "../db";
import {
  activityReports,
  categories,
  comments,
  eventBookmarks,
  eventCategories,
  eventContributions,
  eventEndorsements,
  eventLikes,
  eventParticipations,
  events,
  eventSeries,
  eventSources,
  eventTags,
  notifications,
  reports,
  seriesWatches,
  tags,
  user,
  type Event,
} from "../db/schema";
import { EVENT_FIELDS } from "../validation/event";
import { recountEventCounters } from "./interactions";

export async function dashboardStats(db: Database) {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [users, published, hidden, openReports, newEvents, newComments] = await Promise.all([
    one(db.select({ n: count() }).from(user)),
    one(db.select({ n: count() }).from(events).where(eq(events.status, "published"))),
    one(db.select({ n: count() }).from(events).where(eq(events.status, "hidden"))),
    one(db.select({ n: count() }).from(reports).where(eq(reports.status, "open"))),
    one(db.select({ n: count() }).from(events).where(gte(events.createdAt, since))),
    one(db.select({ n: count() }).from(comments).where(gte(comments.createdAt, since))),
  ]);
  return { users, published, hidden, openReports, newEvents, newComments };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function listReports(db: Database, status: "open" | "all") {
  const rows = await db
    .select({ report: reports, reporterName: user.name })
    .from(reports)
    .leftJoin(user, eq(user.id, reports.reporterId))
    .where(status === "open" ? eq(reports.status, "open") : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(100);

  const ids = (type: string) => rows.filter((r) => r.report.targetType === type).map((r) => r.report.targetId);
  const [evs, cms, acts, usrs] = await Promise.all([
    ids("event").length
      ? db.select({ id: events.id, title: events.title, status: events.status }).from(events).where(inArray(events.id, ids("event")))
      : [],
    ids("comment").length
      ? db
          .select({ id: comments.id, body: comments.body, status: comments.status, eventId: comments.eventId })
          .from(comments)
          .where(inArray(comments.id, ids("comment")))
      : [],
    ids("activity_report").length
      ? db
          .select({ id: activityReports.id, title: activityReports.title, status: activityReports.status })
          .from(activityReports)
          .where(inArray(activityReports.id, ids("activity_report")))
      : [],
    ids("user").length
      ? db.select({ id: user.id, name: user.name, banned: user.banned }).from(user).where(inArray(user.id, ids("user")))
      : [],
  ]);

  return rows.map(({ report, reporterName }) => {
    let target: { label: string; href: string | null; status: string } = {
      label: "（削除済み）",
      href: null,
      status: "missing",
    };
    if (report.targetType === "event") {
      const e = evs.find((x) => x.id === report.targetId);
      if (e) target = { label: e.title, href: `/events/${e.id}`, status: e.status };
    } else if (report.targetType === "comment") {
      const c = cms.find((x) => x.id === report.targetId);
      if (c) target = { label: c.body.slice(0, 80), href: `/events/${c.eventId}#comments`, status: c.status };
    } else if (report.targetType === "activity_report") {
      const a = acts.find((x) => x.id === report.targetId);
      if (a) target = { label: a.title, href: `/activities/${a.id}`, status: a.status };
    } else if (report.targetType === "user") {
      const u = usrs.find((x) => x.id === report.targetId);
      if (u) target = { label: u.name, href: `/users/${u.id}`, status: u.banned ? "banned" : "active" };
    }
    return { ...report, reporterName, target };
  });
}

export async function resolveReport(
  db: Database,
  id: string,
  adminId: string,
  status: "resolved" | "dismissed",
  note: string | null,
) {
  await db
    .update(reports)
    .set({ status, resolvedById: adminId, resolutionNote: note, resolvedAt: new Date() })
    .where(eq(reports.id, id));
}

export async function getReport(db: Database, id: string) {
  return db.query.reports.findFirst({ where: eq(reports.id, id) });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function adminListEvents(db: Database, q: string | null, status: string | null) {
  const where = [];
  if (status === "published" || status === "hidden" || status === "merged") where.push(eq(events.status, status));
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    where.push(
      or(
        sql`${events.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${events.organizer} LIKE ${pattern} ESCAPE '\\'`,
        eq(events.id, q),
      )!,
    );
  }
  return db
    .select({
      id: events.id,
      title: events.title,
      status: events.status,
      startAt: events.startAt,
      createdAt: events.createdAt,
      mergedIntoId: events.mergedIntoId,
      creatorName: user.name,
    })
    .from(events)
    .leftJoin(user, eq(user.id, events.createdById))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(events.createdAt))
    .limit(100);
}

export async function setEventStatus(db: Database, id: string, status: "published" | "hidden", adminId: string) {
  await db.update(events).set({ status, updatedAt: new Date() }).where(eq(events.id, id));
  await db.insert(eventContributions).values({
    id: crypto.randomUUID(),
    eventId: id,
    userId: adminId,
    type: "moderate",
    note: status === "hidden" ? "管理者が非公開にしました" : "管理者が公開しました",
  });
}

export async function deleteEventPermanently(db: Database, id: string) {
  await db.delete(events).where(eq(events.id, id));
}

/**
 * Batch statements that, only if series `from` has no editions left, move its
 * watchers to series `to` (dropping duplicates) and delete it.
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

/**
 * Merge `source` into `target`: empty fields of the target are filled from the
 * source, and likes / bookmarks / participations / comments / activity reports
 * / endorsements / tags / sources / history move to the target. The source
 * remains as a redirect (status = merged) inside the target's series; if its
 * old series is left without editions, the watchers move to the target's
 * series and the old series is deleted. Runs as a single D1 batch
 * (transaction).
 */
export async function mergeEvents(db: Database, source: Event, target: Event, adminId: string) {
  const fill: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of EVENT_FIELDS) {
    const t = target[f];
    const s = source[f];
    const empty = (v: unknown) => v === null || v === "" || v === "unknown";
    if (empty(t) && !empty(s)) {
      fill[f] = s;
      changes[f] = { from: t ?? null, to: s instanceof Date ? s.toISOString() : s };
    }
  }
  if (!target.imageMediaId && source.imageMediaId) fill.imageMediaId = source.imageMediaId;
  if (fill.startAt) fill.startMonth = source.startMonth;
  if (!target.seriesId && source.seriesId) fill.seriesId = source.seriesId;

  const sId = source.id;
  const tId = target.id;
  const seriesMove =
    source.seriesId && target.seriesId && source.seriesId !== target.seriesId
      ? { from: source.seriesId, to: target.seriesId }
      : null;

  // Move rows keyed by (event, X) without violating the composite keys:
  // drop the source rows the target already has, then re-point the rest.
  // likes / bookmarks / participations share the same (user_id, event_id) shape.
  type UserEventTable = typeof eventLikes;
  const moveUnique = (table: UserEventTable) =>
    [
      db
        .delete(table)
        .where(
          and(
            eq(table.eventId, sId),
            inArray(table.userId, db.select({ id: table.userId }).from(table).where(eq(table.eventId, tId))),
          ),
        ),
      db.update(table).set({ eventId: tId }).where(eq(table.eventId, sId)),
    ] as const;

  await db.batch([
    ...moveUnique(eventLikes),
    ...moveUnique(eventBookmarks as unknown as UserEventTable),
    ...moveUnique(eventParticipations as unknown as UserEventTable),
    db
      .delete(eventCategories)
      .where(
        and(
          eq(eventCategories.eventId, sId),
          inArray(
            eventCategories.categoryId,
            db.select({ id: eventCategories.categoryId }).from(eventCategories).where(eq(eventCategories.eventId, tId)),
          ),
        ),
      ),
    db.update(eventCategories).set({ eventId: tId }).where(eq(eventCategories.eventId, sId)),
    db
      .delete(eventSources)
      .where(
        and(
          eq(eventSources.eventId, sId),
          inArray(
            eventSources.normalizedUrl,
            db.select({ url: eventSources.normalizedUrl }).from(eventSources).where(eq(eventSources.eventId, tId)),
          ),
        ),
      ),
    db.update(eventSources).set({ eventId: tId }).where(eq(eventSources.eventId, sId)),
    db
      .delete(eventTags)
      .where(
        and(
          eq(eventTags.eventId, sId),
          inArray(eventTags.tagId, db.select({ id: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, tId))),
        ),
      ),
    db.update(eventTags).set({ eventId: tId }).where(eq(eventTags.eventId, sId)),
    db
      .delete(eventEndorsements)
      .where(
        and(
          eq(eventEndorsements.eventId, sId),
          inArray(
            eventEndorsements.userId,
            db.select({ id: eventEndorsements.userId }).from(eventEndorsements).where(eq(eventEndorsements.eventId, tId)),
          ),
        ),
      ),
    db.update(eventEndorsements).set({ eventId: tId }).where(eq(eventEndorsements.eventId, sId)),
    db.update(comments).set({ eventId: tId }).where(eq(comments.eventId, sId)),
    db.update(activityReports).set({ eventId: tId }).where(eq(activityReports.eventId, sId)),
    db.update(eventContributions).set({ eventId: tId }).where(eq(eventContributions.eventId, sId)),
    db.update(notifications).set({ eventId: tId, link: `/events/${tId}` }).where(eq(notifications.eventId, sId)),
    db
      .update(events)
      .set({ ...fill, updatedAt: new Date() })
      .where(eq(events.id, tId)),
    db
      .update(events)
      .set({
        status: "merged",
        mergedIntoId: tId,
        imageMediaId: null,
        ...(seriesMove ? { seriesId: seriesMove.to } : {}),
        updatedAt: new Date(),
      })
      .where(eq(events.id, sId)),
    ...(seriesMove ? moveEmptySeries(db, seriesMove.from, seriesMove.to) : []),
    db
      .update(tags)
      .set({ useCount: sql`(select count(*) from ${eventTags} where ${eventTags.tagId} = ${tags.id})` })
      .where(inArray(tags.id, db.select({ id: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, tId)))),
    db.insert(eventContributions).values({
      id: crypto.randomUUID(),
      eventId: tId,
      userId: adminId,
      type: "merge",
      note: `重複イベント「${source.title}」を統合しました`,
      changes: Object.keys(changes).length ? changes : null,
    }),
    db
      .update(reports)
      .set({ status: "resolved", resolvedById: adminId, resolvedAt: new Date(), resolutionNote: "イベントを統合" })
      .where(
        and(
          eq(reports.status, "open"),
          eq(reports.reason, "duplicate"),
          or(eq(reports.targetId, sId), eq(reports.duplicateOfEventId, sId)),
        ),
      ),
  ]);
  await recountEventCounters(db, tId);
  await recountEventCounters(db, sId);
}

// ---------------------------------------------------------------------------
// Users, comments, categories, history
// ---------------------------------------------------------------------------

export async function adminListUsers(db: Database, q: string | null) {
  const pattern = q ? `%${escapeLike(q)}%` : null;
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(
      pattern
        ? or(sql`${user.name} LIKE ${pattern} ESCAPE '\\'`, sql`${user.email} LIKE ${pattern} ESCAPE '\\'`)
        : undefined,
    )
    .orderBy(desc(user.createdAt))
    .limit(100);
}

export async function adminListComments(db: Database, status: string | null) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      status: comments.status,
      createdAt: comments.createdAt,
      eventId: comments.eventId,
      eventTitle: events.title,
      userId: comments.userId,
      userName: user.name,
    })
    .from(comments)
    .innerJoin(events, eq(events.id, comments.eventId))
    .innerJoin(user, eq(user.id, comments.userId))
    .where(status === "visible" || status === "hidden" || status === "deleted" ? eq(comments.status, status) : undefined)
    .orderBy(desc(comments.createdAt))
    .limit(100);
}

export async function listAllCategories(db: Database) {
  const usage = db
    .select({ categoryId: eventCategories.categoryId, n: count().as("n") })
    .from(eventCategories)
    .groupBy(eventCategories.categoryId)
    .as("usage");
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      sortOrder: categories.sortOrder,
      isActive: categories.isActive,
      eventCount: sql<number>`coalesce(${usage.n}, 0)`,
    })
    .from(categories)
    .leftJoin(usage, eq(usage.categoryId, categories.id))
    .orderBy(categories.sortOrder, categories.id);
}

export async function recentHistory(db: Database, q: string | null) {
  const pattern = q ? `%${escapeLike(q)}%` : null;
  return db
    .select({
      id: eventContributions.id,
      type: eventContributions.type,
      note: eventContributions.note,
      changes: eventContributions.changes,
      createdAt: eventContributions.createdAt,
      eventId: events.id,
      eventTitle: events.title,
      userId: user.id,
      userName: user.name,
    })
    .from(eventContributions)
    .innerJoin(events, eq(events.id, eventContributions.eventId))
    .leftJoin(user, eq(user.id, eventContributions.userId))
    .where(
      pattern
        ? or(sql`${events.title} LIKE ${pattern} ESCAPE '\\'`, sql`${user.name} LIKE ${pattern} ESCAPE '\\'`)
        : undefined,
    )
    .orderBy(desc(eventContributions.createdAt))
    .limit(150);
}
