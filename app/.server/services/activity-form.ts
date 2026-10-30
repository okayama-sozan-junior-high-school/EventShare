import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db";
import { eventBookmarks, eventParticipations, events, mediaAssets } from "../db/schema";
import { readUpload, storeMedia } from "../media/store";

export const MAX_MEDIA_PER_REPORT = 6;

/** Events offered in the activity report form: joined / bookmarked / recent. */
export async function eventOptionsFor(db: Database, userId: string, now: Date) {
  const mine = db
    .select({ id: eventParticipations.eventId })
    .from(eventParticipations)
    .where(eq(eventParticipations.userId, userId));
  const saved = db
    .select({ id: eventBookmarks.eventId })
    .from(eventBookmarks)
    .where(eq(eventBookmarks.userId, userId));
  return db
    .select({ id: events.id, title: events.title, startAt: events.startAt })
    .from(events)
    .where(
      and(
        eq(events.status, "published"),
        or(
          inArray(events.id, mine),
          inArray(events.id, saved),
          and(
            gte(events.startAt, new Date(now.getTime() - 180 * 86_400_000)),
            lte(events.startAt, now),
          ),
        ),
      ),
    )
    .orderBy(sql`${events.startAt} IS NULL`, desc(events.startAt))
    .limit(100);
}

export async function saveActivityMedia(
  db: Database,
  form: FormData,
  userId: string,
  reportId: string,
) {
  const files = form.getAll("media").filter((f): f is File => typeof f !== "string" && f.size > 0);
  const [{ n: existing }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.activityReportId, reportId), eq(mediaAssets.status, "visible")));
  if (existing + files.length > MAX_MEDIA_PER_REPORT) {
    return { error: `写真・動画は1つの報告につき${MAX_MEDIA_PER_REPORT}件までです` };
  }
  const errors: string[] = [];
  for (const file of files) {
    const upload = await readUpload(file);
    if (!upload) continue;
    if ("tooLarge" in upload) {
      errors.push(`${file.name}: ファイルが大きすぎます`);
      continue;
    }
    const stored = await storeMedia(db, upload.bytes, {
      ownerId: userId,
      allowed: ["image", "video"],
      activityReportId: reportId,
    });
    if (!stored.ok) errors.push(`${file.name}: ${stored.error}`);
  }
  return { error: errors.length > 0 ? errors.join(" / ") : null };
}
