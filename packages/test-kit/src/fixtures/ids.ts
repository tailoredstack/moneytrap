import { ID_PREFIXES, type Id, type IdKind } from "@moneytrap/domain";

/** A stable, valid typed ID for fixtures. The same kind and sequence always yield the same ID. */
export function fixtureId<K extends IdKind>(kind: K, sequence = 1): Id<K> {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 10 ** 26 - 1) {
    throw new RangeError("fixture ID sequence must be a positive safe integer");
  }
  return `${ID_PREFIXES[kind]}_${String(sequence).padStart(26, "0")}` as Id<K>;
}
