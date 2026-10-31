import type { RouteSource, RouteSourceRecord } from "@moneytrap/app";

/** Programmable route source keyed by token. An unknown token resolves to null. Set `failure` to simulate an outage. */
export class FakeRouteSource implements RouteSource {
  private readonly records = new Map<string, RouteSourceRecord>();
  readonly reads: string[] = [];
  failure: Error | null = null;

  set(token: string, record: RouteSourceRecord): void {
    this.records.set(token, record);
  }

  async findByToken(token: string): Promise<RouteSourceRecord | null> {
    this.reads.push(token);
    if (this.failure) throw this.failure;
    return this.records.get(token) ?? null;
  }
}
