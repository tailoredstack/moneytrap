import type {
  ReceiptRecord,
  RecordReceiptOutcome,
  SettlementReceiptStore,
} from "@moneytrap/app/src/ports/settlement-receipt-store";

/** In-memory reference adapter for the settlement receipt store. A receipt keeps its first stored content, as the port requires. */
export class FakeSettlementReceiptStore implements SettlementReceiptStore {
  readonly receipts: ReceiptRecord[] = [];

  async record(receipt: ReceiptRecord): Promise<RecordReceiptOutcome> {
    const existing = this.receipts.find(
      (stored) => stored.networkId === receipt.networkId && stored.externalRef === receipt.externalRef,
    );
    if (existing) return { kind: "existing", existing };
    this.receipts.push(receipt);
    return { kind: "created" };
  }
}
