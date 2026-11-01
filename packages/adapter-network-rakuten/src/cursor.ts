// Cursors are opaque tokens that name the operation, the query scope, and the position inside it. A token from another
// query or operation, or a fabricated one, is a caller bug, so parsing it throws (the simulator does the same).
const PREFIX = "rk1.";

export function issueCursor(operation: string, scope: string, position: readonly number[]): string {
  return `${PREFIX}${Buffer.from(JSON.stringify([operation, scope, position]), "utf8").toString("base64url")}`;
}

export function parseCursor(
  cursor: string | null,
  expected: { operation: string; scope: string; size: number },
): number[] | null {
  if (cursor === null) return null;
  const invalid = () => new RangeError("cursor was not issued for this query");
  if (!cursor.startsWith(PREFIX)) throw invalid();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor.slice(PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(decoded) || decoded.length !== 3) throw invalid();
  const [operation, scope, position] = decoded;
  if (operation !== expected.operation || scope !== expected.scope) throw invalid();
  if (!Array.isArray(position) || position.length !== expected.size) throw invalid();
  if (!position.every((part) => Number.isSafeInteger(part) && part >= 0)) throw invalid();
  return position as number[];
}
