/**
 * D1 allows at most 100 bound parameters per statement, so multi-row inserts
 * must be split by `floor((100 - reserved) / columnsPerRow)` rows, where
 * `reserved` is the number of other parameters in the same statement.
 */
export function chunkForD1<T>(rows: T[], columnsPerRow: number, reserved = 0) {
  const size = Math.max(1, Math.floor((100 - reserved) / columnsPerRow));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
