import type { Clock, IdGenerator } from "@moneytrap/app";
import { Elysia } from "elysia";
import { errorHandler } from "./http/errors";
import { requestId } from "./http/request-id";

// Ports the HTTP layer hands to route plugins. The composition root builds them once and passes them in.
export type AppDeps = { clock: Clock; ids: IdGenerator };

export function createApp(deps: AppDeps) {
  return new Elysia().decorate({ clock: deps.clock, ids: deps.ids }).use(requestId).use(errorHandler);
}
