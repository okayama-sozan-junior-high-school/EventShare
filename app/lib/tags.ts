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
