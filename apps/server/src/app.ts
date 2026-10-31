import type { Clock, IdGenerator } from "@moneytrap/app";
import { Elysia } from "elysia";
import { errorHandler } from "./http/errors";
import { healthRoutes, type ReadinessCheck } from "./http/health";
import { requestId } from "./http/request-id";

// Ports the HTTP layer hands to route plugins. The composition root builds them once and passes them in.
// readiness lists the dependencies /readyz probes; it is empty when the composition root omits it.
export type AppDeps = { clock: Clock; ids: IdGenerator; readiness?: ReadinessCheck[] };

export function createApp(deps: AppDeps) {
  return new Elysia()
    .decorate({ clock: deps.clock, ids: deps.ids })
    .use(requestId)
    .use(errorHandler)
    .use(healthRoutes(deps.readiness));
}
