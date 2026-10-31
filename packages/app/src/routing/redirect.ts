import type { ClickQueue } from "../ports/click-queue";
import type { Clock } from "../ports/clock";
import type { RouteCache } from "../ports/route-cache";
import type { RouteSource } from "../ports/route-source";
import { readRouteView } from "./route-view";

export interface RedirectDeps {
  cache: RouteCache;
  source: RouteSource;
  clicks: ClickQueue;
  clock: Clock;
  // Receives an enqueue failure. The click is lost in that case, and the redirect has already been decided.
  onClickError: (error: unknown) => void;
}

export type RedirectResolution =
  | { kind: "redirect"; destination: string }
  | { kind: "denied" | "missing" | "unavailable" };

// Decides one visitor redirect (UC13, ADR-007). The route view decides: only an allow decision redirects, so a revoked,
// paused, or ineligible link is denied, and an unknown token is missing. The click is enqueued after the decision and is
// not awaited, so the response never waits on the queue. The request ID is the click's dedup key, so a retry of the same
// request cannot record a second click.
export async function resolveRedirect(
  deps: RedirectDeps,
  token: string,
  requestId: string,
): Promise<RedirectResolution> {
  const result = await readRouteView({ cache: deps.cache, source: deps.source }, token);
  if (result.kind === "unavailable") return { kind: "unavailable" };
  if (result.kind === "missing") return { kind: "missing" };
  const { view } = result;
  if (view.decision !== "allow") return { kind: "denied" };

  const click = { dedupKey: `redirect-${requestId}`, linkId: view.linkId, occurredAt: deps.clock.now() };
  void Promise.resolve()
    .then(() => deps.clicks.enqueue(click))
    .catch(deps.onClickError);
  return { kind: "redirect", destination: view.destination };
}
