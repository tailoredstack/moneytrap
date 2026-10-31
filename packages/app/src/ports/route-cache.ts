import type { Id } from "@moneytrap/domain";
import type { RouteView } from "../routing/route-view";

// The Redis route cache (ADR-007). Freshness is decided by the cache's own clock: loadedAt comes from Redis TIME, never
// from an app host, so a host with a skewed clock cannot extend a view.
export interface RouteCache {
  // The Redis server clock in milliseconds. Read before the source read starts.
  readServerTime(): Promise<number>;
  // A fresh entry only: younger than three seconds on the Redis clock, and equal to the published version when one exists.
  get(token: string): Promise<RouteView | null>;
  // Stores the view with the loadedAt the caller captured before its source read. Never re-stamps it.
  put(token: string, view: RouteView, loadedAt: number): Promise<void>;
  // Publishes a link's version after its change commits. Only moves forward.
  publishVersion(linkId: Id<"link">, version: number): Promise<void>;
}
