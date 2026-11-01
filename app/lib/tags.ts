export const MAX_TAGS_PER_EVENT = 8;
export const MAX_TAG_LENGTH = 20;

/** Facets group tags in the form chips and on the tag index. */
export const TAG_FACETS = {
  audience: "対象",
  participation: "参加形態",
  schedule: "日程",
  outcome: "得られるもの",
  other: "その他",
} as const;

export type TagFacetKey = keyof typeof TAG_FACETS;

/**
 * Canonical form of a tag name, used as the unique `slug`:
 * NFKC → drop a leading `#` / `＃` → trim → lower-case ASCII letters →
 * collapse internal whitespace. Unlike `normalizeForMatch()` symbols are kept
 * so that `C++` and `C` stay different tags.
 */
export function normalizeTagName(name: string) {
  return name
    .normalize("NFKC")
    .replace(/^\s*#+/, "")
    .trim()
    .replace(/[A-Z]+/g, (s) => s.toLowerCase())
    .replace(/\s+/g, " ");
}

export const TAG_FACET_ORDER = Object.keys(TAG_FACETS) as TagFacetKey[];

const TAG_SEPARATORS = /[,、\s]+/;

/**
 * Split a form value into canonical tag names.
 * Accepts one comma / ideographic-comma / whitespace separated string,
 * or repeated field values. Empty tokens are dropped. Duplicates after
 * `normalizeTagName` collapse to the first one. Does not enforce the
 * length or count limits — `tagListError` does, and over-limit input is
 * an error rather than a silent truncation.
 */
export function parseTagInput(raw: string | readonly string[] | null | undefined) {
  const chunks = raw == null ? [] : typeof raw === "string" ? [raw] : raw;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (typeof chunk !== "string") continue;
    for (const part of chunk.split(TAG_SEPARATORS)) {
      const name = normalizeTagName(part);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Japanese error for a parsed tag list, or null when it is acceptable. */
export function tagListError(names: readonly string[]) {
  for (const name of names) {
    if (name.length < 1 || name.length > MAX_TAG_LENGTH) {
      return "タグは1〜20文字で入力してください";
    }
  }
  if (names.length > MAX_TAGS_PER_EVENT) return "タグは8個までです";
  return null;
}

/**
 * Tags submitted with an edit.
 * `replace` is the poster / admin set. `add` keeps tags already on the
 * event so other logged-in users can add but not remove.
 */
export function mergeTagNames(
  current: readonly string[],
  incoming: readonly string[],
  mode: "replace" | "add",
) {
  if (mode === "replace") return parseTagInput(incoming);
  return parseTagInput([...current, ...incoming]);
}

export type SeriesEditionRef = {
  id: string;
  seriesId: string | null;
  startAt: Date | null;
};

/**
 * One row per series. The card is the edition with the latest `startAt`
 * (missing dates sort last). `count` is how many of `rows` share that series.
 * Rows with no series stay separate.
 */
export function groupBySeries<T extends SeriesEditionRef>(rows: readonly T[]) {
  const groups = new Map<string, { item: T; count: number; latestAt: number }>();
  for (const row of rows) {
    const key = row.seriesId ?? `event:${row.id}`;
    const at = row.startAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { item: row, count: 1, latestAt: at });
      continue;
    }
    group.count += 1;
    if (at > group.latestAt) {
      group.item = row;
      group.latestAt = at;
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.latestAt - a.latestAt ||
        (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
    )
    .map(({ item, count }) => ({ item, count }));
}

export function groupTagsByFacet<T extends { facet: TagFacetKey }>(items: readonly T[]) {
  const buckets = new Map<TagFacetKey, T[]>();
  for (const item of items) {
    const list = buckets.get(item.facet);
    if (list) list.push(item);
    else buckets.set(item.facet, [item]);
  }
  return TAG_FACET_ORDER.filter((facet) => buckets.has(facet)).map((facet) => ({
    facet,
    label: TAG_FACETS[facet],
    tags: buckets.get(facet) ?? [],
  }));
}
