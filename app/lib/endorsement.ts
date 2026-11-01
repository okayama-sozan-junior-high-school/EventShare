import { getEventPhase, type EventPhase } from "./event-phase";
import { seriesStats, type SeriesEdition } from "./series-stats";

/** An edition plus the end time `getEventPhase` needs to tell "ended" from "ongoing". */
export type RecurringSoonEdition = SeriesEdition & { endAt?: Date | null };

/**
 * A user may endorse an edition that has already ended, or any edition they
 * have marked as participated. Other phases (open, closing, closed, ongoing,
 * unknown) require participation. There is no cancelled phase.
 */
export function canEndorse(eventPhase: EventPhase, participated: boolean) {
  return eventPhase === "ended" || participated;
}

/** `null` when `comment` is 1–200 characters after trim. */
export function endorsementCommentError(comment: string): string | null {
  const trimmed = comment.trim();
  if (trimmed.length < 1) return "一言を入力してください";
  if (trimmed.length > 200) return "一言は200文字以内で入力してください";
  return null;
}

/**
 * Series to show in 「そろそろ募集の時期」.
 * Keeps input order. A series qualifies when it has at least two published
 * editions, `seriesStats.isRecurringSoon(now)` is true, and the latest
 * published edition has ended.
 */
export function pickRecurringSoon<T extends { editions: RecurringSoonEdition[] }>(
  seriesList: readonly T[],
  now: Date,
  timeZone: string,
): T[] {
  const picked: T[] = [];
  for (const series of seriesList) {
    const stats = seriesStats(series.editions, timeZone);
    const latest = stats.latest;
    if (stats.count < 2 || !latest || !stats.isRecurringSoon(now)) continue;
    const phase = getEventPhase(
      {
        startAt: latest.startAt,
        endAt: latest.endAt ?? null,
        applicationDeadline: latest.applicationDeadline,
      },
      now,
    );
    if (phase !== "ended") continue;
    picked.push(series);
  }
  return picked;
}
