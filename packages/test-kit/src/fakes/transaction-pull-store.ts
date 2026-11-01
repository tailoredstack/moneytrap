import type { PullCursor, TransactionPullStore } from "@moneytrap/app/src/ports/transaction-pull-store";

/** In-memory reference adapter for the transaction pull cursor store. */
export class FakeTransactionPullStore implements TransactionPullStore {
  private readonly cursors = new Map<string, PullCursor>();

  async loadCursor(networkId: string, scope: string): Promise<PullCursor> {
    return { ...(this.cursors.get(cursorKey(networkId, scope)) ?? { cursor: null, watermark: null }) };
  }

  async saveCursor(networkId: string, scope: string, state: PullCursor): Promise<void> {
    this.cursors.set(cursorKey(networkId, scope), { ...state });
  }
}

function cursorKey(networkId: string, scope: string): string {
  return `${networkId}\u0000${scope}`;
}
