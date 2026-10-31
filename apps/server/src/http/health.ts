import { Elysia } from "elysia";
import { createLogger, type Logger } from "../telemetry/logger";

// A dependency the service needs before it can take traffic. The composition root supplies these
// (database, queue, ...); a check that throws or rejects marks the dependency unavailable.
export type ReadinessCheck = { name: string; check: () => unknown | Promise<unknown> };

type CheckState = "ok" | "unavailable";

// /healthz says the process is up and does not touch dependencies, so a dead database cannot make
// the orchestrator restart healthy pods. /readyz reports whether every check passes and returns 503
// when one fails. The response names the failing check but never its error, which can carry a
// connection string.
export function healthRoutes(checks: ReadinessCheck[] = [], logger: Logger = createLogger()) {
  return new Elysia({ name: "health" })
    .get("/healthz", () => ({ status: "ok" }))
    .get("/readyz", async ({ set }) => {
      const results = await Promise.all(
        checks.map(async ({ name, check }): Promise<[string, CheckState]> => {
          try {
            await check();
            return [name, "ok"];
          } catch {
            logger.error("readiness check failed", { check: name });
            return [name, "unavailable"];
          }
        }),
      );
      const ready = results.every(([, state]) => state === "ok");
      if (!ready) set.status = 503;
      return { status: ready ? "ok" : "unavailable", checks: Object.fromEntries(results) };
    });
}
