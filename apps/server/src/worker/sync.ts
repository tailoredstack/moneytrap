import { type SyncCatalogResult, type SyncDeps, syncCatalog } from "@moneytrap/app/src/networks/sync-catalog";

export interface CatalogSyncWorkerOptions extends SyncDeps {
  sleep?: (ms: number) => Promise<void>;
  // Total attempts for one run, including the first. Only temporarily_unavailable is retried.
  maxAttempts?: number;
  baseBackoffMs?: number;
}

const MAX_BACKOFF_MS = 60_000;

// Runs one catalog sync for a network. A temporarily_unavailable failure is retried with bounded backoff, honoring the
// upstream's retry-after when it gives one (TP-W4-004). Every other failure, including not_authorized, returns at once.
// A retry resumes the scope that was in progress from its saved cursor. Scopes that already completed in this run are
// walked again; that is harmless, because every revision is compared with the latest one before it is written.
export async function runCatalogSync(options: CatalogSyncWorkerOptions, networkId: string): Promise<SyncCatalogResult> {
  const { sleep = (ms) => Bun.sleep(ms), maxAttempts = 3, baseBackoffMs = 1_000, ...deps } = options;
  for (let attempt = 1; ; attempt++) {
    const result = await syncCatalog(deps, { networkId });
    if (result.ok) return result;
    if (result.failure.state !== "temporarily_unavailable" || attempt >= maxAttempts) return result;
    const retryAfterMs = result.failure.retryAfterSeconds === null ? null : result.failure.retryAfterSeconds * 1_000;
    const delayMs = retryAfterMs ?? baseBackoffMs * 2 ** (attempt - 1);
    await sleep(Math.min(delayMs, MAX_BACKOFF_MS));
  }
}
