import { getConfig } from "../config";
import { createDb } from "../db";
import { cleanupOrphanMedia } from "../media/store";
import { pruneNotifications, sendReminders } from "./notifications";

/** Cron Trigger entry point (see `triggers.crons` in wrangler.jsonc). */
export async function runScheduledJobs(now: Date) {
  const db = createDb();
  const { timeZone } = getConfig();
  const reminders = await sendReminders(db, now, timeZone);
  const removedMedia = await cleanupOrphanMedia(db, now);
  await pruneNotifications(db, now);
  console.log(
    JSON.stringify({ job: "scheduled", reminders, removedMedia, at: now.toISOString() }),
  );
}
