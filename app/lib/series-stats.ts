import { zonedParts } from "./datetime";

export type SeriesEdition = {
  id: string;
  startAt: Date | null;
  applicationDeadline: Date | null;
  status: string;
};

export type SeriesCadence = "yearly" | "twice_yearly";

const DAY = 86_400_000;
const MONTH = (365.25 / 12) * DAY;

function cadenceOf(starts: Date[]): SeriesCadence | null {
  if (starts.length < 2) return null;
  const sorted = [...starts].sort((a, b) => a.getTime() - b.getTime());
  const gaps = sorted.slice(1).map((d, i) => (d.getTime() - sorted[i].getTime()) / MONTH);
  if (gaps.every((g) => g >= 10 && g <= 14)) return "yearly";
  if (gaps.every((g) => g >= 5 && g <= 7)) return "twice_yearly";
  return null;
}

/**
 * Most frequent month (1-12). Ties go to the month of the most recent date,
 * so a series that moved from July to August reports August on a tie.
 */
function modeMonth(dates: Date[], timeZone: string) {
  if (dates.length === 0) return null;
  const counts = new Map<number, { n: number; last: number }>();
  for (const d of dates) {
    const month = zonedParts(d, timeZone).month;
    const c = counts.get(month) ?? { n: 0, last: 0 };
    counts.set(month, { n: c.n + 1, last: Math.max(c.last, d.getTime()) });
  }
  let best: [number, { n: number; last: number }] | null = null;
  for (const entry of counts) {
    if (!best || entry[1].n > best[1].n || (entry[1].n === best[1].n && entry[1].last > best[1].last)) {
      best = entry;
    }
  }
  return best![0];
}

/**
 * Values derived from the editions of a series (never stored). Only
 * published editions count.
 *
 * - `cadence`: every gap between start dates is 10-14 months → yearly,
 *   5-7 months → twice a year, otherwise null (needs 2+ dated editions).
 * - `typicalStartMonth` / `typicalDeadlineMonth`: most frequent month in
 *   `timeZone`.
 * - `latest`: newest start date; editions without a date come last.
 * - `isRecurringSoon(now)`: 2+ editions, the typical deadline month is 0-2
 *   months ahead of `now`, and this cycle's edition is not posted yet — no
 *   edition starts within the next 10 months or started in the last 2
 *   (so a just-held edition does not trigger it either).
 */
export function seriesStats<E extends SeriesEdition>(editions: E[], timeZone: string) {
  const published = editions.filter((e) => e.status === "published");
  const starts = published.map((e) => e.startAt).filter((d): d is Date => !!d);
  const deadlines = published.map((e) => e.applicationDeadline).filter((d): d is Date => !!d);

  let latest: E | null = null;
  for (const e of published) {
    if (!latest || (e.startAt && (!latest.startAt || e.startAt > latest.startAt))) latest = e;
  }
  const typicalStartMonth = modeMonth(starts, timeZone);
  const typicalDeadlineMonth = modeMonth(deadlines, timeZone);

  return {
    count: published.length,
    cadence: cadenceOf(starts),
    typicalStartMonth,
    typicalDeadlineMonth,
    latest,
    isRecurringSoon(now: Date) {
      if (published.length < 2 || typicalDeadlineMonth === null) return false;
      const monthsAhead = (typicalDeadlineMonth - zonedParts(now, timeZone).month + 12) % 12;
      if (monthsAhead > 2) return false;
      const from = now.getTime() - 2 * MONTH;
      const to = now.getTime() + 10 * MONTH;
      return !starts.some((d) => d.getTime() >= from && d.getTime() <= to);
    },
  };
}

export type SeriesStats<E extends SeriesEdition = SeriesEdition> = ReturnType<typeof seriesStats<E>>;
