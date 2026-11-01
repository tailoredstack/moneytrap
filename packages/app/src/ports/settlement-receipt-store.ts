import type { CurrencyCode, Id } from "@moneytrap/domain";

// One settlement receipt, the stored form of DM-041. (networkId, externalRef) is its source identity: the same network
// reference is one receipt, however many times the file that carries it is imported.
export interface ReceiptRecord {
  id: Id<"settlementReceipt">;
  networkId: string;
  externalRef: string;
  grossMinor: bigint;
  currency: CurrencyCode;
  receivedAt: Date;
  state: string;
  objectRef: string | null;
}

// created: nothing was stored under this identity before. existing: a receipt with this identity is already stored, and it
// is returned unchanged so the caller can compare the two.
export type RecordReceiptOutcome = { kind: "created" } | { kind: "existing"; existing: ReceiptRecord };

// A stored receipt is never updated or deleted. record writes the receipt only when its identity is free, and it stays
// atomic under a concurrent import of the same reference.
export interface SettlementReceiptStore {
  record(receipt: ReceiptRecord): Promise<RecordReceiptOutcome>;
}
