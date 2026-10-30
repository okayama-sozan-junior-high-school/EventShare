import { z } from "zod";
import { toDateKey } from "~/lib/datetime";
import { normalizeUrl } from "~/lib/url";
import {
  diceSimilarity,
  jaccardSimilarity,
  normalizeForMatch,
} from "~/lib/text";

/**
 * Duplicate-event scoring. Weights / thresholds are configuration (stored in
 * `app_settings` under `duplicate_detection`) so they can be tuned with real
 * data without code changes.
 */
export const duplicateConfigSchema = z.object({
  weights: z.object({
    title: z.number().min(0).max(100),
    date: z.number().min(0).max(100),
    organizer: z.number().min(0).max(100),
    location: z.number().min(0).max(100),
    description: z.number().min(0).max(100),
  }),
  thresholds: z.object({
    /** score >= high → 重複の可能性が高い */
    high: z.number().min(0).max(100),
    /** review <= score < high → 確認が必要 */
    review: z.number().min(0).max(100),
  }),
  /** Bonus when official URLs match. A strong signal, but never decisive. */
  urlMatchBonus: z.number().min(0).max(100),
  /** Same name but dates further apart than this → treated as another edition. */
  differentEditionDays: z.number().int().min(1).max(3650),
});

export type DuplicateConfig = z.infer<typeof duplicateConfigSchema>;

export const DEFAULT_DUPLICATE_CONFIG: DuplicateConfig = {
  weights: { title: 40, date: 25, organizer: 15, location: 10, description: 10 },
  thresholds: { high: 80, review: 55 },
  urlMatchBonus: 15,
  differentEditionDays: 120,
};

export type DuplicateComparable = {
  title: string;
  description?: string | null;
  startAt?: Date | null;
  organizer?: string | null;
  location?: string | null;
  format?: string | null;
  officialUrl?: string | null;
};

export type DuplicateLevel = "high" | "review" | "low";

export type DuplicateScore = {
  score: number;
  level: DuplicateLevel;
  breakdown: Record<keyof DuplicateConfig["weights"], number>;
  urlMatch: boolean;
  differentEdition: boolean;
};

const DAY = 86_400_000;

function dateSimilarity(
  a: Date | null | undefined,
  b: Date | null | undefined,
  timeZone: string,
) {
  if (!a || !b) return 0;
  if (toDateKey(a, timeZone) === toDateKey(b, timeZone)) return 1;
  const days = Math.abs(a.getTime() - b.getTime()) / DAY;
  if (days <= 1) return 0.8;
  if (days <= 3) return 0.5;
  if (days <= 7) return 0.3;
  return 0;
}

const YEAR_RE = /(?:19|20)\d{2}/g;

function yearsIn(text: string) {
  return new Set(text.normalize("NFKC").match(YEAR_RE) ?? []);
}

/** e.g. "Hackathon 2025" vs "Hackathon 2026" → different editions. */
function titlesHaveDifferentYears(a: string, b: string) {
  const ya = yearsIn(a);
  const yb = yearsIn(b);
  if (ya.size === 0 || yb.size === 0) return false;
  for (const y of ya) if (yb.has(y)) return false;
  return true;
}

function locationSimilarity(a: DuplicateComparable, b: DuplicateComparable) {
  const la = normalizeForMatch(a.location);
  const lb = normalizeForMatch(b.location);
  if (la && lb) return diceSimilarity(la, lb);
  if (a.format === "online" && b.format === "online") return 1;
  return 0;
}

export function scoreDuplicate(
  a: DuplicateComparable,
  b: DuplicateComparable,
  config: DuplicateConfig = DEFAULT_DUPLICATE_CONFIG,
  timeZone = "Asia/Tokyo",
): DuplicateScore {
  const w = config.weights;
  const titleA = normalizeForMatch(a.title);
  const titleB = normalizeForMatch(b.title);

  const breakdown = {
    title: diceSimilarity(titleA, titleB) * w.title,
    date: dateSimilarity(a.startAt, b.startAt, timeZone) * w.date,
    organizer:
      diceSimilarity(
        normalizeForMatch(a.organizer),
        normalizeForMatch(b.organizer),
      ) * w.organizer,
    location: locationSimilarity(a, b) * w.location,
    description:
      jaccardSimilarity(
        normalizeForMatch(a.description).slice(0, 600),
        normalizeForMatch(b.description).slice(0, 600),
      ) * w.description,
  };

  const urlA = normalizeUrl(a.officialUrl);
  const urlMatch = urlA !== null && urlA === normalizeUrl(b.officialUrl);

  const farApart =
    !!a.startAt &&
    !!b.startAt &&
    Math.abs(a.startAt.getTime() - b.startAt.getTime()) >
      config.differentEditionDays * DAY;
  const differentEdition = farApart || titlesHaveDifferentYears(a.title, b.title);

  let score = Object.values(breakdown).reduce((s, v) => s + v, 0);
  if (urlMatch) score += config.urlMatchBonus;
  score = Math.min(100, score);
  if (differentEdition) score = Math.min(score, config.thresholds.review - 1);
  score = Math.round(score);

  const level: DuplicateLevel =
    score >= config.thresholds.high
      ? "high"
      : score >= config.thresholds.review
        ? "review"
        : "low";

  for (const k of Object.keys(breakdown) as (keyof typeof breakdown)[]) {
    breakdown[k] = Math.round(breakdown[k] * 10) / 10;
  }

  return { score, level, breakdown, urlMatch, differentEdition };
}
