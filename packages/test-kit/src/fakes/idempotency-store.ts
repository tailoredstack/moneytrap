import type { IdempotencyStore, StoredResponse } from "@moneytrap/app";

// In-memory stand-in for the idempotency_requests table, keyed the same way: scope plus hashed key.
export class FakeIdempotencyStore implements IdempotencyStore {
  private readonly rows = new Map<string, StoredResponse>();

  async find(scope: string, keyHash: string): Promise<StoredResponse | null> {
    return this.rows.get(`${scope}:${keyHash}`) ?? null;
  }

  async save(scope: string, keyHash: string, response: StoredResponse): Promise<void> {
    this.rows.set(`${scope}:${keyHash}`, response);
  }

  size(): number {
    return this.rows.size;
  }

  entries(): [string, StoredResponse][] {
    return [...this.rows.entries()];
  }
}
