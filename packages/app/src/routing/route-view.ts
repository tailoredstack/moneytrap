import { type Id, type Link, type LinkStatus, validateDestination } from "@moneytrap/domain";
import type { RouteCache } from "../ports/route-cache";
import type { RouteSource, RouteSourceRecord } from "../ports/route-source";

// What the redirect path needs to decide one link (ADR-007, blueprint §5.3). Lane B owns this shape, and WP-5.2 reads it,
// so its fields stay stable. `decision` is the answer the redirect acts on: allow only when the link is active, eligible,
// and its destination still passes the allow-list. `allowedHosts` is carried so the redirect can re-run that check on a cache hit.
export interface RouteView {
  readonly linkId: Id<"link">;
  readonly destination: string;
  readonly state: LinkStatus;
  readonly eligible: boolean;
  readonly allowedHosts: readonly string[];
  readonly decision: "allow" | "deny";
  readonly version: number;
}

export type RouteViewResult = { kind: "found"; view: RouteView } | { kind: "missing" } | { kind: "unavailable" };

// Built from the link aggregate, the eligibility the source reports for its property and program, and the program's
// allow-list. The destination uses the WP-5.1 rule, so a host no longer on the list decides deny. Pure, so the same
// inputs always yield the same view.
export function buildRouteView(link: Link, eligible: boolean, allowedHosts: readonly string[]): RouteView {
  const destinationAllowed = validateDestination(link.destinationUrl, allowedHosts).ok;
  return {
    linkId: link.id,
    destination: link.destinationUrl,
    state: link.status,
    eligible,
    allowedHosts,
    decision: link.status === "active" && eligible && destinationAllowed ? "allow" : "deny",
    version: link.version,
  };
}

// A Redis call that outlives this is treated as a cache outage, so a stalled cache cannot hold the redirect.
const CACHE_DEADLINE_MS = 100;

export function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("route cache deadline exceeded")), CACHE_DEADLINE_MS);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

// Reads a route view for a token. A fresh cache entry answers without a source read. Otherwise the cache clock is read
// before the source read starts, so the stored loadedAt bounds the entry's life (ADR-007 rule 1). Redis or Postgres
// failures never produce a view: a Redis failure falls back to the source, and a source failure is unavailable.
export async function readRouteView(
  deps: { cache: RouteCache; source: RouteSource },
  token: string,
): Promise<RouteViewResult> {
  let cacheDown = false;
  try {
    const cached = await withDeadline(deps.cache.get(token));
    if (cached) return { kind: "found", view: cached };
  } catch {
    // A cache outage requires a source read. The redirect still answers.
    cacheDown = true;
  }

  // A cache that just failed will not answer the clock either. Skipping it keeps an outage to one deadline, not two.
  let loadedAt: number | null = null;
  if (!cacheDown) {
    try {
      loadedAt = await withDeadline(deps.cache.readServerTime());
    } catch {
      // Without a cache clock the view is not stored, so the next request reads the source again.
    }
  }

  let record: RouteSourceRecord | null;
  try {
    record = await deps.source.findByToken(token);
  } catch {
    return { kind: "unavailable" };
  }
  if (!record) return { kind: "missing" };

  const view = buildRouteView(record.link, record.eligible, record.allowedHosts);
  if (loadedAt !== null) {
    // Not awaited, so a slow cache write never delays the response. A failed write leaves Postgres authoritative.
    withDeadline(Promise.resolve().then(() => deps.cache.put(token, view, loadedAt))).catch(() => {});
  }
  return { kind: "found", view };
}
