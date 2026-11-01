export interface PullCursor {
  // The page the next call resumes from. Null when no pass is in progress.
  cursor: string | null;
  // The freshness instant the upstream reported on the last completed pass. Kept while a later pass is in progress.
  watermark: Date | null;
}

// Cursor state for one pull, keyed by network and query scope (the time range). Each save is a single-row write.
export interface TransactionPullStore {
  loadCursor(networkId: string, scope: string): Promise<PullCursor>;
  saveCursor(networkId: string, scope: string, state: PullCursor): Promise<void>;
}
