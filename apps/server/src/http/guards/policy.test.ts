import { describe, expect, test } from "bun:test";
import type { Id, Principal } from "@moneytrap/domain";
import { decide, type Guard } from "./policy";

const userId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const orgA = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const orgB = "org_01bx5zzkbkactav9wevgemmvrz" as Id<"organization">;

const viewerOfA: Principal = { userId, memberships: [{ organizationId: orgA, role: "viewer" }] };
const adminOfA: Principal = { userId, memberships: [{ organizationId: orgA, role: "admin" }] };

// A fake store: resource IDs map to the organization that owns them. Unknown IDs resolve to null, like a missing row.
const owners: Record<string, Id<"organization">> = { res_a: orgA, res_b: orgB };
const resolve = async (params: Readonly<Record<string, string>>) => {
  const owner = owners[params.id ?? ""];
  return owner ? { organizationId: owner } : null;
};

const readCatalog: Guard = { access: "permission", permission: "catalog:read", scope: resolve };
const writeCatalog: Guard = { access: "permission", permission: "catalog:write", scope: resolve };

describe("guard decisions (Blueprint §3.1, TP-W2-036)", () => {
  test("public and delegated routes allow anonymous callers without resolving a principal", async () => {
    expect(await decide({ access: "public" }, null, {})).toEqual({ ok: true });
    expect(await decide({ access: "delegated", reason: "Better Auth" }, null, {})).toEqual({ ok: true });
  });

  test("session routes refuse anonymous callers and allow any signed-in user", async () => {
    expect(await decide({ access: "session" }, null, {})).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(await decide({ access: "session" }, viewerOfA, {})).toEqual({ ok: true });
  });

  test("permission routes refuse anonymous callers", async () => {
    expect(await decide(readCatalog, null, { id: "res_a" })).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  test("a member whose role holds the permission is allowed", async () => {
    expect(await decide(readCatalog, viewerOfA, { id: "res_a" })).toEqual({ ok: true });
  });

  test("a member whose role lacks the permission gets FORBIDDEN", async () => {
    expect(await decide(writeCatalog, viewerOfA, { id: "res_a" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await decide(writeCatalog, adminOfA, { id: "res_a" })).toEqual({ ok: true });
  });
});

describe("not-found rule (CT-005, TP-W2-033, TP-W2-034)", () => {
  test("a foreign resource returns RESOURCE_NOT_FOUND even when the role would allow the action", async () => {
    // adminOfA could write catalog in org A, but res_b belongs to org B: the answer must not reveal it exists.
    expect(await decide(writeCatalog, adminOfA, { id: "res_b" })).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(await decide(readCatalog, viewerOfA, { id: "res_b" })).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("a foreign resource and a nonexistent one get the same decision", async () => {
    const foreign = await decide(readCatalog, viewerOfA, { id: "res_b" });
    const missing = await decide(readCatalog, viewerOfA, { id: "res_nope" });
    expect(foreign).toEqual(missing);
  });

  test("the decision ignores anything the caller could send besides the route parameters", async () => {
    // A scope taken from a client header would have to come through the resolver, which only reads route params.
    // Naming org B in a header changes nothing: membership decides, so the answer stays RESOURCE_NOT_FOUND.
    const withHeaderOnly = await decide(readCatalog, viewerOfA, { id: "res_b", org_id: orgB });
    expect(withHeaderOnly).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });
});
