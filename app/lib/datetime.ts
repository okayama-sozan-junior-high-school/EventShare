export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

/** Calendar fields of `date` as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** Offset (ms) of `timeZone` from UTC at instant `ts`. */
function offsetMs(ts: number, timeZone: string) {
  const p = zonedParts(new Date(ts), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/**
 * Interpret a `<input type="datetime-local">` / `<input type="date">` value
 * as wall-clock time in `timeZone` and return the UTC instant.
 */
export function zonedLocalToDate(local: string, timeZone: string): Date | null {
  const m = LOCAL_RE.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  if (Number.isNaN(guess)) return null;
  let ts = guess - offsetMs(guess, timeZone);
  const second = offsetMs(ts, timeZone);
  if (guess - second !== ts) ts = guess - second;
  const check = zonedParts(new Date(ts), timeZone);
  if (check.month !== +mo || check.day !== +d) return null;
  return new Date(ts);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Format a Date for `<input type="datetime-local">` in `timeZone`. */
export function toDateTimeLocalValue(
  date: Date | null | undefined,
  timeZone: string,
) {
  if (!date) return "";
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** `YYYY-MM-DD` of `date` in `timeZone`. */
export function toDateKey(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function weekday(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
}

/** 2026年11月3日(火) 13:00 */
export function formatDateTime(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.year}年${p.month}月${p.day}日(${weekday(date, timeZone)}) ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 2026年11月3日(火) */
export function formatDate(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.year}年${p.month}月${p.day}日(${weekday(date, timeZone)})`;
}

/** 11/3(火) 13:00 — compact form for cards. */
export function formatShortDateTime(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.month}/${p.day}(${weekday(date, timeZone)}) ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatRange(
  start: Date,
  end: Date | null | undefined,
  timeZone: string,
) {
  const s = formatDateTime(start, timeZone);
  if (!end) return s;
  if (toDateKey(start, timeZone) === toDateKey(end, timeZone)) {
    const p = zonedParts(end, timeZone);
    return `${s} 〜 ${pad(p.hour)}:${pad(p.minute)}`;
  }
  return `${s} 〜 ${formatDateTime(end, timeZone)}`;
}

/** Whole days from `now` until `date` (negative if past), in `timeZone`. */
export function daysUntil(date: Date, now: Date, timeZone: string) {
  const a = zonedParts(now, timeZone);
  const b = zonedParts(date, timeZone);
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const db = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((db - da) / 86_400_000);
}

export function formatRelative(date: Date, now: Date) {
  const diff = now.getTime() - date.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}日前`;
  return `${Math.round(d / 30)}か月前`;
}
