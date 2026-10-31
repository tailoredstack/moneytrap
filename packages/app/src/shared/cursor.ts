// Keyset pagination for list queries. The position is the (sort, id) pair of the last row returned.
// Ties on the sort key are broken by id, so every list has one total order and pages neither skip nor repeat rows.
// The HTTP edge signs the position into an opaque cursor (contracts/src/pagination.ts); this module never sees the signature.

export type Position = { sort: string; id: string };

export type KeysetPage<T> = { items: T[]; nextPosition: Position | null };

// Code-unit order, the same as a SQL ORDER BY under the C collation. Locale collation would disagree with the database.
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function keysetPage<T extends { id: string }>(
  rows: readonly T[],
  options: { limit: number; after?: Position | undefined; sortKey: (row: T) => string },
): KeysetPage<T> {
  const { limit, after, sortKey } = options;
  const compare = (a: T, b: T) => byCodeUnit(sortKey(a), sortKey(b)) || byCodeUnit(a.id, b.id);

  const sorted = [...rows].sort(compare);
  const remaining = after
    ? sorted.filter((row) => {
        const bySort = byCodeUnit(sortKey(row), after.sort);
        return bySort > 0 || (bySort === 0 && byCodeUnit(row.id, after.id) > 0);
      })
    : sorted;

  const items = remaining.slice(0, limit);
  const last = items.at(-1);
  const hasMore = remaining.length > items.length;
  return {
    items,
    nextPosition: hasMore && last ? { sort: sortKey(last), id: last.id } : null,
  };
}
