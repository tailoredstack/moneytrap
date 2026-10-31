import type { RouteCache, RouteView } from "@moneytrap/app";
import type { Id } from "@moneytrap/domain";

const MAX_AGE_MS = 3000;

/** In-memory route cache with the ADR-007 rules. `now` stands in for the Redis clock, and `failure` simulates an outage. */
export class FakeRouteCache implements RouteCache {
  private readonly views = new Map<string, { view: RouteView; loadedAt: number }>();
  private readonly versions = new Map<string, number>();
  now = 1_000_000;
  failure: Error | null = null;

  async readServerTime(): Promise<number> {
    if (this.failure) throw this.failure;
    return this.now;
  }

  async get(token: string): Promise<RouteView | null> {
    if (this.failure) throw this.failure;
    const entry = this.views.get(token);
    if (!entry) return null;
    const age = this.now - entry.loadedAt;
    if (age < 0 || age >= MAX_AGE_MS) return null;
    const published = this.versions.get(entry.view.linkId);
    if (published !== undefined && published !== entry.view.version) return null;
    return { ...entry.view };
  }

  async put(token: string, view: RouteView, loadedAt: number): Promise<void> {
    if (this.failure) throw this.failure;
    this.views.set(token, { view: { ...view }, loadedAt });
  }

  async publishVersion(linkId: Id<"link">, version: number): Promise<void> {
    if (this.failure) throw this.failure;
    if (version > (this.versions.get(linkId) ?? -1)) this.versions.set(linkId, version);
  }
}
