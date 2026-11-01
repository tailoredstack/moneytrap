import { describe, expect, test } from "bun:test";
import type { Id, Membership, Principal, Role } from "@moneytrap/domain";
import { FakeProgramApprovalStore } from "@moneytrap/test-kit";
import { createApp } from "../app";
import { ROUTE_GUARDS } from "./guards/routes";
import { PROGRAM_APPROVAL_PATH, programApprovalRoutes } from "./program-approval";

const orgA = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const orgB = "org_01brz3ndektsv4rrffq69g5fav" as Id<"organization">;
const user = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const propertyA = "prp_01arz3ndektsv4rrffq69g5fav";
const propertyB = "prp_01brz3ndektsv4rrffq69g5fav";
const programId = "prg_01arz3ndektsv4rrffq69g5fav";
const clock = { now: () => new Date("2026-11-01T12:00:00.000Z") };
let next = 0;
const ids = { next: (kind: string) => `${kind}_${String(++next).padStart(26, "0")}` } as never;

// The caller's role in orgA is set by the test through a header. No header means an anonymous caller.
function principalFrom(headers: Headers): Promise<Principal | null> {
  const role = headers.get("x-role") as Role | null;
  if (!role) return Promise.resolve(null);
  const memberships: Membership[] = [{ organizationId: orgA, role }];
  return Promise.resolve({ userId: user, memberships });
}

function app(store = new FakeProgramApprovalStore()) {
  store.properties.set(propertyA, orgA);
  store.properties.set(propertyB, orgB);
  store.setNetworkApproval(programId, null);
  // createApp installs the server's error handler, which maps validation failures to 400, as in production.
  const server = createApp({ clock, ids, readiness: [] }).use(
    programApprovalRoutes({ db: {} as never, store, clock, ids, principal: principalFrom }),
  );
  return { store, server };
}

const url = (org: string) => `http://localhost/api/organizations/${org}/programs/${programId}/request-approval`;

function post(server: ReturnType<typeof app>["server"], org: string, body: unknown, role: Role | null = "editor") {
  return server.handle(
    new Request(url(org), {
      method: "POST",
      headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/organizations/:organizationId/programs/:programId/request-approval (API-035, WP-4.10)", () => {
  test("a member with catalog:write gets 202 pending, and the request is stored for the path's organization", async () => {
    const { server, store } = app();
    const response = await post(server, orgA, { property_id: propertyA });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ state: "pending" });
    expect(store.requests.get(`${propertyA}|${programId}`)?.organizationId).toBe(orgA);
    expect(store.audits).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  test("a repeat request returns the stored request and writes no second audit row or event", async () => {
    const { server, store } = app();
    await post(server, orgA, { property_id: propertyA });
    const response = await post(server, orgA, { property_id: propertyA });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ state: "pending" });
    expect(store.audits).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  test("an organization_id in the body is ignored; the organization comes only from the path", async () => {
    const { server, store } = app();
    const response = await post(server, orgA, { property_id: propertyA, organization_id: orgB });

    expect(response.status).toBe(202);
    expect(store.requests.get(`${propertyA}|${programId}`)?.organizationId).toBe(orgA);
  });

  test("the network's reported approval is the state returned, and a request alone never reads as approved", async () => {
    const { server, store } = app();
    const pending = await post(server, orgA, { property_id: propertyA });
    expect(await pending.json()).toEqual({ state: "pending" });

    store.setNetworkApproval(programId, "approved");
    const repeat = await post(server, orgA, { property_id: propertyA });
    expect(repeat.status).toBe(202);
    expect(await repeat.json()).toEqual({ state: "approved" });
  });

  test("a property owned by another organization is RESOURCE_NOT_FOUND and nothing is written", async () => {
    const { server, store } = app();
    const response = await post(server, orgA, { property_id: propertyB });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });
    expect(store.requests.size).toBe(0);
  });

  test("a caller who is not a member of the path's organization gets RESOURCE_NOT_FOUND", async () => {
    const { server, store } = app();
    const response = await post(server, orgB, { property_id: propertyB });

    expect(response.status).toBe(404);
    expect(store.requests.size).toBe(0);
  });

  test("a body without property_id is a validation failure and nothing is written", async () => {
    const { server, store } = app();
    const response = await post(server, orgA, {});

    expect(response.status).toBe(400);
    expect(store.requests.size).toBe(0);
  });

  // TP-W4-026: the guard rejects a request without catalog:write, and no route reaches an approved write.
  test("TP-W4-026: a role without catalog:write is refused and nothing is written", async () => {
    for (const role of ["viewer", "analyst", "finance"] as const) {
      const { server, store } = app();
      const response = await post(server, orgA, { property_id: propertyA }, role);
      expect(response.status).toBe(403);
      expect(store.requests.size).toBe(0);
    }
  });

  test("TP-W4-026: an anonymous caller is refused before the handler runs", async () => {
    const { server, store } = app();
    const response = await post(server, orgA, { property_id: propertyA }, null);

    expect(response.status).toBe(401);
    expect(store.requests.size).toBe(0);
  });

  test("TP-W4-026: no route in the approval surface is an approved write", () => {
    const served = programApprovalRoutes({
      db: {} as never,
      store: new FakeProgramApprovalStore(),
      clock,
      ids,
      principal: principalFrom,
    });
    const approvalRoutes = served.routes
      .filter((route) => route.path.includes("approv"))
      .map((route) => `${route.method} ${route.path}`);
    expect(approvalRoutes).toEqual([`POST ${PROGRAM_APPROVAL_PATH}`]);
    expect(Object.keys(ROUTE_GUARDS).filter((key) => /approv/.test(key) && !key.endsWith("/request-approval"))).toEqual(
      [],
    );
  });
});
