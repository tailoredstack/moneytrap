import { describe, expect, test } from "bun:test";
import type { ClickCountQuery, ClickReportStore } from "@moneytrap/app/src/ports/click-report-store";
import type { Id, Membership, Principal, Role } from "@moneytrap/domain";
import { Elysia } from "elysia";
import { reportRoutes } from "./reports";

const orgA = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const orgB = "org_01brz3ndektsv4rrffq69g5fav" as Id<"organization">;
const user = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const clock = { now: () => new Date("2026-11-01T12:00:00.000Z") };

// The caller's identity and memberships are set by the test through headers, so each case states its own roles.
function principalFrom(headers: Headers): Promise<Principal | null> {
  const role = headers.get("x-role") as Role | null;
  if (!role) return Promise.resolve(null);
  const memberships: Membership[] = [{ organizationId: orgA, role }];
  return Promise.resolve({ userId: user, memberships });
}

class RecordingStore implements ClickReportStore {
  queries: ClickCountQuery[] = [];
  async countByLink(query: ClickCountQuery) {
    this.queries.push(query);
    return [{ linkId: "lnk_a", clicks: 4 }];
  }
  async latestRecordedAt() {
    return new Date("2026-11-01T11:59:00.000Z");
  }
}

function app(store = new RecordingStore()) {
  return { store, server: new Elysia().use(reportRoutes({ clicks: store, clock, principal: principalFrom })) };
}

const url = (org: string, query = "from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z") =>
  `http://localhost/api/organizations/${org}/reports/clicks?${query}`;

describe("GET /api/organizations/:organizationId/reports/clicks (API-045, WP-5.9)", () => {
  test("a member with reports:read gets the counts with as_of and data_stale", async () => {
    const { server, store } = app();
    const response = await server.handle(new Request(url(orgA), { headers: { "x-role": "owner" } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ link_id: "lnk_a", clicks: 4 }],
      next_cursor: null,
      as_of: "2026-11-01T12:00:00.000Z",
      data_stale: false,
    });
    expect(store.queries[0]?.organizationId).toBe(orgA);
  });

  test("no session is UNAUTHENTICATED", async () => {
    const { server } = app();
    const response = await server.handle(new Request(url(orgA)));
    expect(response.status).toBe(401);
  });

  test("a role without reports:read is FORBIDDEN and nothing is read", async () => {
    const { server, store } = app();
    const response = await server.handle(new Request(url(orgA), { headers: { "x-role": "finance" } }));
    expect(response.status).toBe(403);
    expect(store.queries).toHaveLength(0);
  });

  test("an organization the caller does not belong to reads as not found, with no count", async () => {
    const { server, store } = app();
    const response = await server.handle(new Request(url(orgB), { headers: { "x-role": "owner" } }));
    expect(response.status).toBe(404);
    expect(store.queries).toHaveLength(0);
  });

  test("a malformed organization ID reads as not found", async () => {
    const { server } = app();
    const response = await server.handle(new Request(url("not-an-org"), { headers: { "x-role": "owner" } }));
    expect(response.status).toBe(404);
  });

  test("an invalid window is a validation failure", async () => {
    const { server, store } = app();
    const response = await server.handle(
      new Request(url(orgA, "from=2026-11-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z"), {
        headers: { "x-role": "owner" },
      }),
    );
    expect(response.status).toBe(400);
    expect(store.queries).toHaveLength(0);
  });
});
