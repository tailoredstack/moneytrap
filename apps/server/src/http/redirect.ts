import { type RedirectDeps, resolveRedirect } from "@moneytrap/app";
import { Elysia } from "elysia";
import { guard } from "./guards/enforce";
import { requestIdOf } from "./request-id";

export const REDIRECT_PATH = "/r/:token";
// The key the guard table uses for this route: the method and the path.
export const REDIRECT_KEY = `GET ${REDIRECT_PATH}`;

// The visitor redirect (UC13, API-043). The answer is one of three: a 302 to the destination, a 410 that does not say
// why the link was refused, or a 503 with no Location when both stores are down. Every answer is uncacheable, so a
// browser or proxy never replays an old destination.
// Mounted only when the composition root supplies the deps. Without them the route is not served at all.
export function redirectRoutes(deps?: RedirectDeps) {
  const app = new Elysia({ name: "redirect" });
  if (!deps) return app;
  return app.get(REDIRECT_PATH, guard(REDIRECT_KEY), async ({ params, request, set }) => {
    const outcome = await resolveRedirect(deps, params.token, requestIdOf(request));
    set.headers["cache-control"] = "no-store";
    if (outcome.kind === "redirect") {
      set.status = 302;
      set.headers.location = outcome.destination;
      return "";
    }
    if (outcome.kind === "unavailable") {
      set.status = 503;
      return "Service unavailable";
    }
    set.status = 410;
    return "Gone";
  });
}
