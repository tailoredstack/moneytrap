import type { Id, IdKind } from "@moneytrap/domain";

// The only source of new entity IDs. Each ID carries its type prefix (spec §4.2).
export interface IdGenerator {
  next<K extends IdKind>(kind: K): Id<K>;
}
