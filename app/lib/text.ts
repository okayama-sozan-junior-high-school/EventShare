/**
 * Normalize text for similarity comparison: NFKC (全角→半角), lower-case,
 * strip whitespace / punctuation / symbols.
 */
export function normalizeForMatch(value: string | null | undefined) {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(s: string) {
  const grams = new Map<string, number>();
  if (s.length === 1) grams.set(s, 1);
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice coefficient on character bigrams (0..1). */
export function diceSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    overlap += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** Jaccard similarity on sets of character bigrams (0..1). */
export function jaccardSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  const sa = new Set(bigrams(a).keys());
  const sb = new Set(bigrams(b).keys());
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Escape `%`, `_` and `\` for a SQL LIKE pattern using `ESCAPE '\'`. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
