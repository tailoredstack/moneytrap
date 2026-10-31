// Idempotency identity for repeated commands (Blueprint §5.2, DM-053). A stored response is keyed by scope and
// the hash of the caller's key, so the raw key is never persisted. The store is a port: adapters implement it,
// and the HTTP layer decides what to do with what it returns.

export type StoredResponse = { requestHash: string; status: number; headers: Record<string, string>; body: string };

export interface IdempotencyStore {
  find(scope: string, keyHash: string): Promise<StoredResponse | null>;
  save(scope: string, keyHash: string, response: StoredResponse): Promise<void>;
}

export type ReplayDecision =
  | { kind: "miss" }
  | { kind: "replay"; status: number; headers: Record<string, string>; body: string }
  | { kind: "conflict" };

// Same key and same request hash return the stored response. Same key with a different hash is a conflict.
export function decideReplay(stored: StoredResponse | null, requestHash: string): ReplayDecision {
  if (!stored) return { kind: "miss" };
  if (stored.requestHash !== requestHash) return { kind: "conflict" };
  return { kind: "replay", status: stored.status, headers: stored.headers, body: stored.body };
}
