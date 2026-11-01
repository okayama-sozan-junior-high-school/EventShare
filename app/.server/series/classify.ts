import { stripEditionMarkers } from "~/lib/edition";
import { diceSimilarity, normalizeForMatch } from "~/lib/text";
import { hostnameOf } from "~/lib/url";

/**
 * Dice threshold for a weak series candidate. Kept as a constant (the same
 * coefficient `scoreDuplicate` uses for titles) so it can move to
 * `app_settings` later without a schema change in this step.
 */
export const SERIES_DICE_THRESHOLD = 0.8;

export const SERIES_WEAK_LIMIT = 3;

/** `normalizeForMatch(stripEditionMarkers(title) || title)`. */
export function seriesMatchKey(title: string) {
  const stripped = stripEditionMarkers(title).trim();
  return normalizeForMatch(stripped || title.trim());
}

export function displaySeriesTitle(title: string) {
  return stripEditionMarkers(title).trim() || title.trim();
}

export type SeriesCandidateInput = {
  title: string;
  organizer?: string | null;
  /** Official or source URL. Only the host is compared. */
  sourceUrl?: string | null;
  excludeEventId?: string;
};

export type SeriesCandidateRow = {
  seriesId: string;
  seriesTitle: string;
  /** Stored `event_series.match_key` (backfill may still include the year). */
  matchKey: string;
  eventId: string;
  eventTitle: string;
  normalizedTitle: string;
  organizer: string | null;
  officialUrl: string | null;
};

export type ClassifiedCandidate = {
  seriesId: string;
  title: string;
  dice: number;
  eventId: string;
  eventTitle: string;
  organizer: string | null;
  officialUrl: string | null;
};

type Scored = ClassifiedCandidate & { strong: boolean; weak: boolean };

function organizerMatches(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);
  return left.length > 0 && left === right;
}

function hostMatches(a: string | null | undefined, b: string | null | undefined) {
  const left = hostnameOf(a);
  const right = hostnameOf(b);
  return !!left && left === right;
}

function scoreRow(input: SeriesCandidateInput, row: SeriesCandidateRow, inputKey: string): Scored {
  const editionKey = seriesMatchKey(row.eventTitle);
  const keyMatch = row.matchKey === inputKey || editionKey === inputKey;
  const dice = Math.max(
    diceSimilarity(inputKey, row.matchKey),
    diceSimilarity(inputKey, editionKey),
    diceSimilarity(normalizeForMatch(input.title), row.normalizedTitle || normalizeForMatch(row.eventTitle)),
  );
  const organizerMatch = organizerMatches(input.organizer, row.organizer);
  const hostMatch = hostMatches(input.sourceUrl, row.officialUrl);
  // Strong only when THIS edition carries both the key and the organizer/host.
  const strong = keyMatch && (organizerMatch || hostMatch);
  const weak = !strong && (keyMatch || dice >= SERIES_DICE_THRESHOLD);
  return {
    seriesId: row.seriesId,
    title: row.seriesTitle,
    dice,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    organizer: row.organizer,
    officialUrl: row.officialUrl,
    strong,
    weak,
  };
}

function prefer(current: Scored, next: Scored) {
  if (next.strong !== current.strong) return next.strong;
  if (next.dice !== current.dice) return next.dice > current.dice;
  return next.eventId < current.eventId;
}

/**
 * Groups edition rows into one strong candidate (or none) and up to three
 * weak ones. The event in `excludeEventId` is ignored. A series is strong
 * when some remaining edition has the same match key and the same organizer
 * or URL host; key-only and Dice ≥ 0.8 matches stay weak.
 */
export function classifySeriesCandidates(input: SeriesCandidateInput, rows: SeriesCandidateRow[]) {
  const inputKey = seriesMatchKey(input.title);
  const bySeries = new Map<string, Scored>();

  for (const row of rows) {
    if (!row.seriesId || row.eventId === input.excludeEventId) continue;
    const scored = scoreRow(input, row, inputKey);
    const prev = bySeries.get(row.seriesId);
    if (!prev) {
      bySeries.set(row.seriesId, scored);
      continue;
    }
    const nextIsBetter = prefer(prev, scored);
    prev.strong = prev.strong || scored.strong;
    prev.weak = prev.weak || scored.weak;
    if (nextIsBetter) {
      prev.dice = scored.dice;
      prev.eventId = scored.eventId;
      prev.eventTitle = scored.eventTitle;
      prev.organizer = scored.organizer;
      prev.officialUrl = scored.officialUrl;
      prev.title = scored.title;
    } else if (scored.dice > prev.dice) {
      prev.dice = scored.dice;
    }
  }

  const ranked = [...bySeries.values()].sort(
    (a, b) => b.dice - a.dice || a.seriesId.localeCompare(b.seriesId),
  );
  const strong = ranked.find((row) => row.strong) ?? null;
  const weak = ranked.filter((row) => !row.strong && row.weak).slice(0, SERIES_WEAK_LIMIT);

  const present = (row: Scored): ClassifiedCandidate => ({
    seriesId: row.seriesId,
    title: row.title,
    dice: row.dice,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    organizer: row.organizer,
    officialUrl: row.officialUrl,
  });

  return {
    strong: strong ? present(strong) : null,
    weak: weak.map(present),
  };
}
