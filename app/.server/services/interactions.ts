import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import {
  comments,
  eventBookmarks,
  eventEndorsements,
  eventLikes,
  eventParticipations,
  events,
  reports,
  user,
  REPORT_REASONS,
  REPORT_TARGETS,
} from "../db/schema";

async function recount(db: Database, eventId: string) {
  await db
    .update(events)
    .set({
      likeCount: sql`(select count(*) from ${eventLikes} where ${eventLikes.eventId} = ${eventId})`,
      bookmarkCount: sql`(select count(*) from ${eventBookmarks} where ${eventBookmarks.eventId} = ${eventId})`,
      commentCount: sql`(select count(*) from ${comments} where ${comments.eventId} = ${eventId} and ${comments.status} = 'visible')`,
      endorsementCount: sql`(select count(*) from ${eventEndorsements} where ${eventEndorsements.eventId} = ${eventId} and ${eventEndorsements.status} = 'visible')`,
    })
    .where(eq(events.id, eventId));
}

type ToggleTable = typeof eventLikes | typeof eventBookmarks | typeof eventParticipations;

async function toggle(db: Database, table: ToggleTable, userId: string, eventId: string, on: boolean) {
  if (on) {
    const inserted = await db
      .insert(table)
      .values({ userId, eventId })
      .onConflictDoNothing()
      .returning({ userId: table.userId });
    await recount(db, eventId);
    return inserted.length > 0;
  }
  await db.delete(table).where(and(eq(table.userId, userId), eq(table.eventId, eventId)));
  await recount(db, eventId);
  return false;
}

/** Returns true when a new like was created (used to notify the poster once). */
export const setLike = (db: Database, userId: string, eventId: string, on: boolean) =>
  toggle(db, eventLikes, userId, eventId, on);
export const setBookmark = (db: Database, userId: string, eventId: string, on: boolean) =>
  toggle(db, eventBookmarks, userId, eventId, on);
export const setParticipation = (db: Database, userId: string, eventId: string, on: boolean) =>
  toggle(db, eventParticipations, userId, eventId, on);

export async function getViewerState(db: Database, userId: string | undefined, eventId: string) {
  if (!userId) return { liked: false, bookmarked: false, participated: false };
  const has = async (table: ToggleTable) =>
    (
      await db
        .select({ n: count() })
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.eventId, eventId)))
    )[0].n > 0;
  const [liked, bookmarked, participated] = await Promise.all([
    has(eventLikes),
    has(eventBookmarks),
    has(eventParticipations),
  ]);
  return { liked, bookmarked, participated };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function listComments(db: Database, eventId: string) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      userId: comments.userId,
      userName: user.name,
    })
    .from(comments)
    .innerJoin(user, eq(user.id, comments.userId))
    .where(and(eq(comments.eventId, eventId), eq(comments.status, "visible")))
    .orderBy(asc(comments.createdAt))
    .limit(300);
}

export async function addComment(db: Database, eventId: string, userId: string, body: string) {
  const id = crypto.randomUUID();
  await db.insert(comments).values({ id, eventId, userId, body });
  await recount(db, eventId);
  return id;
}

export async function getComment(db: Database, id: string) {
  return db.query.comments.findFirst({ where: eq(comments.id, id) });
}

export async function editComment(db: Database, id: string, body: string) {
  await db.update(comments).set({ body, editedAt: new Date() }).where(eq(comments.id, id));
}

export async function setCommentStatus(
  db: Database,
  id: string,
  eventId: string,
  status: "visible" | "hidden" | "deleted",
) {
  await db.update(comments).set({ status }).where(eq(comments.id, id));
  await recount(db, eventId);
}

// ---------------------------------------------------------------------------
// Reports (通報)
// ---------------------------------------------------------------------------

export type ReportTarget = (typeof REPORT_TARGETS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];

export async function createReport(
  db: Database,
  input: {
    reporterId: string;
    targetType: ReportTarget;
    targetId: string;
    reason: ReportReason;
    detail: string | null;
    duplicateOfEventId: string | null;
  },
) {
  const inserted = await db
    .insert(reports)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  return inserted.length > 0;
}

export { recount as recountEventCounters };
