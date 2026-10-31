import { describe, expect, test } from "bun:test";
import type { Id, IdKind } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { OrganizationStore, OrganizationWrite } from "../ports/organization-store";
import { createOrganization } from "./create-org";

const actorId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const otherId = "usr_01bx5zzkbkactav9wevgemmvrz" as Id<"user">;
const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;

// Stub IDs keep assertions readable. Each kind gets a fixed, prefixed value.
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    return `${kind === "organization" ? "org" : kind}_01arz3ndektsv4rrffq69g5fav` as Id<K>;
  },
};

const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

function ctxFor(actor: Ctx["actor"]): Ctx {
  return { db: undefined as never, clock, ids, actor };
}

// Models the adapter contract: both rows land together or neither does.
class MemoryStore implements OrganizationStore {
  organizations: OrganizationWrite["organization"][] = [];
  memberships: OrganizationWrite["ownerMembership"][] = [];
  failMembership = false;

  // Stage both rows, then commit together. A failure between the inserts must roll the staged row back.
  async createWithOwner(write: OrganizationWrite): Promise<void> {
    const stagedOrganization = { ...write.organization };
    if (this.failMembership) throw new Error("membership insert failed");
    const stagedMembership = { ...write.ownerMembership };
    this.organizations.push(stagedOrganization);
    this.memberships.push(stagedMembership);
  }
}

const valid = { name: "Acme Media", country: "ES", base_currency: "EUR" };

describe("createOrganization", () => {
  test("creates the organization and makes the actor its owner", async () => {
    const store = new MemoryStore();
    const result = await createOrganization(ctxFor({ type: "user", id: actorId }), store, valid);

    expect(result).toEqual({
      ok: true,
      value: { id: "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">, status: "active" },
    });
    expect(store.organizations).toHaveLength(1);
    expect(store.organizations[0]).toMatchObject({
      name: "Acme Media",
      country: "ES",
      baseCurrency: "EUR",
      createdBy: actorId,
    });
    expect(store.memberships).toEqual([{ organizationId: orgId, userId: actorId, role: "owner" }]);
  });

  test("ignores a client-supplied owner and creator", async () => {
    const store = new MemoryStore();
    await createOrganization(ctxFor({ type: "user", id: actorId }), store, {
      ...valid,
      owner_id: otherId,
      created_by: otherId,
      role: "viewer",
    });

    expect(store.organizations[0]?.createdBy).toBe(actorId);
    expect(store.memberships[0]).toMatchObject({ userId: actorId, role: "owner" });
  });

  test("rejects a caller that is not a user", async () => {
    const store = new MemoryStore();
    const result = await createOrganization(ctxFor({ type: "system", id: null }), store, valid);

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(store.organizations).toHaveLength(0);
  });

  test("rejects invalid input without writing", async () => {
    const store = new MemoryStore();
    const bad = [
      { ...valid, name: "   " },
      { ...valid, country: "Spain" },
      { ...valid, base_currency: "XXX-NOPE" },
      { name: "Acme" },
      "not an object",
    ];
    for (const input of bad) {
      const result = await createOrganization(ctxFor({ type: "user", id: actorId }), store, input);
      expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED", reason: expect.any(String) });
    }
    expect(store.organizations).toHaveLength(0);
  });

  test("writes neither row when the membership write fails", async () => {
    const store = new MemoryStore();
    store.failMembership = true;

    await expect(createOrganization(ctxFor({ type: "user", id: actorId }), store, valid)).rejects.toThrow(
      "membership insert failed",
    );
    expect(store.organizations).toHaveLength(0);
    expect(store.memberships).toHaveLength(0);
  });
});
