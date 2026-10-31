// Keyset pagination for list queries. The position is the (sort, id) pair of the last row returned.
// Ties on the sort key are broken by id, so every list has one total order and pages neither skip nor repeat rows.
// The HTTP edge signs the position into an opaque cursor (contracts/src/pagination.ts); this module never sees the signature.

export type Position = { sort: string; id: string };

export type KeysetPage<T> = { items: T[]; nextPosition: Position | null };

export function keysetPage<T extends { id: string }>(
  rows: readonly T[],
  options: { limit: number; after?: Position | undefined; sortKey: (row: T) => string },
): KeysetPage<T> {
  const { limit, after, sortKey } = options;
  const compare = (a: T, b: T) => {
    const bySort = sortKey(a).localeCompare(sortKey(b));
    return bySort !== 0 ? bySort : a.id.localeCompare(b.id);
  };

  const sorted = [...rows].sort(compare);
  const remaining = after
    ? sorted.filter((row) => {
        const bySort = sortKey(row).localeCompare(after.sort);
        return bySort > 0 || (bySort === 0 && row.id.localeCompare(after.id) > 0);
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
