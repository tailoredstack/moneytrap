import type {
  ConnectorFailure,
  ConnectorResult,
  NetworkConnector,
  TimeRange,
  TransactionRecord,
} from "../ports/network-connector";
import type { TransactionPullStore } from "../ports/transaction-pull-store";

export interface PullDeps {
  connector: Pick<NetworkConnector, "listTransactions">;
  store: TransactionPullStore;
}

export type PullTransactionsResult =
  | { ok: true; value: { pages: number; watermark: Date } }
  | { ok: false; failure: ConnectorFailure };

// Pulls every transaction in the range, one page at a time. A page is handed to `onPage` before its cursor is saved, so an
// interrupted pull resumes at the page it did not finish and never skips one. A resumed pull can repeat items from the
// page it stopped on, and the import is idempotent for them. The watermark is stored only when a pass completes (spec
// §6.1, TP-W6-025).
export async function pullTransactions(
  deps: PullDeps,
  input: TimeRange & { networkId: string },
  onPage: (items: TransactionRecord[]) => Promise<void>,
): Promise<PullTransactionsResult> {
  const { connector, store } = deps;
  const { networkId, from, to } = input;
  const scope = `transactions:${from.getTime()}..${to.getTime()}`;
  const saved = await store.loadCursor(networkId, scope);

  let cursor = saved.cursor;
  let pages = 0;
  for (;;) {
    const result = await guarded(() => connector.listTransactions({ from, to, cursor }));
    if (!result.ok) return { ok: false, failure: result.failure };

    await onPage(result.value.items);
    pages += 1;
    if (result.value.nextCursor === null) {
      const watermark = result.value.watermark;
      await store.saveCursor(networkId, scope, { cursor: null, watermark });
      return { ok: true, value: { pages, watermark } };
    }
    cursor = result.value.nextCursor;
    await store.saveCursor(networkId, scope, { cursor, watermark: saved.watermark });
  }
}

// A connector that throws instead of returning a ConnectorFailure is an adapter bug. The thrown error is discarded, so its
// message cannot reach the caller. The pull reports a retryable failure instead.
async function guarded<T>(call: () => Promise<ConnectorResult<T>>): Promise<ConnectorResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } };
  }
}
