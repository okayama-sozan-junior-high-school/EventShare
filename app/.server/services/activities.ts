import { and, asc, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { Database } from "../db";
import { activityReports, events, mediaAssets, user } from "../db/schema";
import { mediaUrl } from "./events";

export type ActivitySummary = {
  id: string;
  title: string;
  excerpt: string;
  createdAt: Date;
  user: { id: string; name: string };
  event: { id: string; title: string };
  thumbnailUrl: string | null;
};

async function thumbnails(db: Database, reportIds: string[]) {
  const map = new Map<string, string>();
  if (reportIds.length === 0) return map;
  const rows = await db
    .select({ id: mediaAssets.id, reportId: mediaAssets.activityReportId })
    .from(mediaAssets)
    .where(
      and(
        inArray(mediaAssets.activityReportId, reportIds),
        eq(mediaAssets.kind, "image"),
        eq(mediaAssets.status, "visible"),
      ),
    )
    .orderBy(asc(mediaAssets.createdAt));
  for (const r of rows) if (r.reportId && !map.has(r.reportId)) map.set(r.reportId, mediaUrl(r.id)!);
  return map;
}

export async function listActivities(
  db: Database,
  options: { eventId?: string; userId?: string; limit?: number; offset?: number } = {},
) {
  const where: SQL[] = [eq(activityReports.status, "visible"), eq(events.status, "published")];
  if (options.eventId) where.push(eq(activityReports.eventId, options.eventId));
  if (options.userId) where.push(eq(activityReports.userId, options.userId));

  const rows = await db
    .select({
      id: activityReports.id,
      title: activityReports.title,
      activity: activityReports.activity,
      createdAt: activityReports.createdAt,
      userId: user.id,
      userName: user.name,
      eventId: events.id,
      eventTitle: events.title,
    })
    .from(activityReports)
    .innerJoin(user, eq(user.id, activityReports.userId))
    .innerJoin(events, eq(events.id, activityReports.eventId))
    .where(and(...where))
    .orderBy(desc(activityReports.createdAt))
    .limit(options.limit ?? 12)
    .offset(options.offset ?? 0);

  const thumbs = await thumbnails(
    db,
    rows.map((r) => r.id),
  );
  return rows.map(
    (r): ActivitySummary => ({
      id: r.id,
      title: r.title,
      excerpt: r.activity.replace(/\s+/g, " ").slice(0, 120),
      createdAt: r.createdAt,
      user: { id: r.userId, name: r.userName },
      event: { id: r.eventId, title: r.eventTitle },
      thumbnailUrl: thumbs.get(r.id) ?? null,
    }),
  );
}

export async function countActivities(db: Database) {
  const [row] = await db
    .select({ n: count() })
    .from(activityReports)
    .innerJoin(events, eq(events.id, activityReports.eventId))
    .where(and(eq(activityReports.status, "visible"), eq(events.status, "published")));
  return row.n;
}

export async function getActivity(db: Database, id: string) {
  const [row] = await db
    .select({
      report: activityReports,
      userName: user.name,
      eventTitle: events.title,
      eventStatus: events.status,
    })
    .from(activityReports)
    .innerJoin(user, eq(user.id, activityReports.userId))
    .innerJoin(events, eq(events.id, activityReports.eventId))
    .where(eq(activityReports.id, id))
    .limit(1);
  if (!row) return null;
  const media = await db
    .select({ id: mediaAssets.id, kind: mediaAssets.kind })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.activityReportId, id), eq(mediaAssets.status, "visible")))
    .orderBy(asc(mediaAssets.createdAt));
  return {
    ...row.report,
    userName: row.userName,
    eventTitle: row.eventTitle,
    eventStatus: row.eventStatus,
    media: media.map((m) => ({ id: m.id, kind: m.kind, url: mediaUrl(m.id)! })),
  };
}

export type ActivityInput = {
  eventId: string;
  title: string;
  motivation: string | null;
  activity: string;
  reflection: string | null;
  relatedUrl: string | null;
};

export async function createActivity(db: Database, userId: string, input: ActivityInput) {
  const id = crypto.randomUUID();
  await db.insert(activityReports).values({ id, userId, ...input });
  return id;
}

export async function updateActivity(db: Database, id: string, input: Omit<ActivityInput, "eventId">) {
  await db
    .update(activityReports)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(activityReports.id, id));
}

export async function setActivityStatus(
  db: Database,
  id: string,
  status: "visible" | "hidden" | "deleted",
) {
  await db.update(activityReports).set({ status }).where(eq(activityReports.id, id));
  await db.update(mediaAssets).set({ status }).where(eq(mediaAssets.activityReportId, id));
}
