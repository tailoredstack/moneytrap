import type { Id } from "@moneytrap/domain";
import type { RouteCache } from "../ports/route-cache";
import { withDeadline } from "./route-view";

// ADR-007. A committed link change publishes its new version straight to the cache, after the write commits. A cached
// view at an older version then fails the version check, so the next redirect reads the source and sees the change. The
// publish is bounded and its failure is swallowed: the write has already committed, and a missed publish only delays the
// change to the three-second freshness bound.
export async function invalidateRouteView(cache: RouteCache, linkId: Id<"link">, version: number): Promise<void> {
  try {
    await withDeadline(cache.publishVersion(linkId, version));
  } catch {
    // Covered by the freshness bound in ADR-007 rule 1.
  }
}
