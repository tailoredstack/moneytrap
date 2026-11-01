import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createApp } from "../../app";
import { apiRoutes } from "../routes";
import { undeclaredRoutes } from "./coverage";
import { guard } from "./enforce";
import { ROUTE_GUARDS } from "./routes";

// Auth is replaced with a stub: these tests only care which routes exist and which guard each one declares.
const stubAuth = {
  handler: () => new Response("ok"),
  api: { getSession: async () => null },
} as never;

const clock = { now: () => new Date("2026-10-31T12:00:00Z") };
const ids = { next: () => "x" } as never;
// Reports are wired with inert stores: these tests only check that the route exists and declares its guard.
const reports = {
  clicks: { countByLink: async () => [], recordedDelayMs: async () => null },
  clock,
  principal: async () => null,
};
// The redirect is wired with inert deps for the same reason. These tests register the route and never call it.
const redirect = { cache: {}, source: {}, clicks: {}, clock, onClickError: () => {} } as never;
// The approval route is wired with an inert store for the same reason. These tests never call it.
const approvals = { db: {}, store: {}, clock, ids, principal: async () => null } as never;

describe("route guard coverage (Blueprint §7, TP-W2-035)", () => {
  test("every route the app serves declares a guard", () => {
    const app = createApp({ clock, ids, readiness: [] }).use(
      apiRoutes(
        stubAuth,
        undefined,
        reports,
        redirect,
        approvals,
        {
          db: {},
          store: {},
          secretBox: {},
          clock,
          ids,
          principal: async () => null,
        } as never,
        {
          store: {
            listForOrganization: async () => [],
            findForOrganization: async () => null,
            list: async () => [],
            findClosed: async () => null,
            recordClosed: async () => false,
            downloadUrl: async () => "https://example.test/x",
          },
          principal: async () => null,
        },
      ),
    );
    expect(undeclaredRoutes(app.routes)).toEqual([]);
  });

  test("a route with no guard declaration is listed by the build check", () => {
    const app = new Elysia().get("/api/unguarded", () => "x");
    expect(undeclaredRoutes(app.routes)).toEqual(["GET /api/unguarded"]);
  });

  test("a route whose key is in the table but installs no guard is listed", () => {
    // /healthz has a table entry, but this registration never calls guard(), so nothing runs before the handler.
    const app = new Elysia().get("/healthz", () => "ok");
    expect(undeclaredRoutes(app.routes)).toEqual(["GET /healthz"]);
  });

  test("a guard installed for a different route does not count", () => {
    const app = new Elysia().get("/healthz", guard("GET /readyz"), () => "ok");
    expect(undeclaredRoutes(app.routes)).toEqual(["GET /healthz"]);
  });

  test("the guard table has no entry for a route the app does not serve", () => {
    const app = createApp({ clock, ids, readiness: [] }).use(
      apiRoutes(
        stubAuth,
        undefined,
        reports,
        redirect,
        approvals,
        {
          db: {},
          store: {},
          secretBox: {},
          clock,
          ids,
          principal: async () => null,
        } as never,
        {
          store: {
            listForOrganization: async () => [],
            findForOrganization: async () => null,
            list: async () => [],
            findClosed: async () => null,
            recordClosed: async () => false,
            downloadUrl: async () => "https://example.test/x",
          },
          principal: async () => null,
        },
      ),
    );
    const served = new Set(app.routes.map((route) => `${route.method} ${route.path}`));
    const stale = Object.keys(ROUTE_GUARDS).filter((key) => !served.has(key));
    expect(stale).toEqual([]);
  });

  test("a route whose key has no table entry cannot be registered", () => {
    expect(() => guard("GET /api/undeclared")).toThrow("route GET /api/undeclared has no guard declaration");
  });
});
