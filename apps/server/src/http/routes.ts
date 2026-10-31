import type { RedirectDeps } from "@moneytrap/app";
import { Elysia } from "elysia";
import { serveWebAsset } from "../assets";
import type { createAuth } from "../auth/config";
import { type AuthHandler, authRoutes } from "./auth";
import { guard } from "./guards/enforce";
import { redirectRoutes } from "./redirect";
import { type ReportWiring, reportRoutes } from "./reports";
import { sessionRoutes } from "./sessions";

// Every route the server serves, apart from the health probes that createApp mounts. Each one declares its guard
// from the table in guards/routes.ts, so an undeclared route stops the server from starting.
export function apiRoutes(
  auth: AuthHandler & Pick<ReturnType<typeof createAuth>, "api">,
  options: { trustProxy: boolean } = { trustProxy: true },
  reports?: ReportWiring,
  redirect?: RedirectDeps,
) {
  return new Elysia({ name: "api" })
    .use(authRoutes(auth, options))
    .use(sessionRoutes(auth))
    .use(reportRoutes(reports))
    .use(redirectRoutes(redirect))
    .get("/api/health", guard("GET /api/health"), () => ({ status: "ok" }))
    .get("/*", guard("GET /*"), ({ request }) => {
      const { pathname } = new URL(request.url);
      // The API namespace never falls through to the shell, so a mistyped API path gets a 404.
      if (pathname === "/api" || pathname.startsWith("/api/")) return notFound();
      return serveWebAsset(pathname) ?? notFound();
    });
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}
