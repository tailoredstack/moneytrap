import { describe, expect, test } from "bun:test";
import type { Id, IdKind, Principal } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PayoutMethodStore, PayoutMethodWrite } from "../ports/payout-method-store";
import { disablePayoutMethod, enrollPayoutMethod, listPayoutMethods } from "./methods";

const userId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const otherOrgId = "org_01brz3ndektsv4rrffq69g5fav" as Id<"organization">;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const scope = { organizationId: orgId };
const owner: Principal = { userId, memberships: [{ organizationId: orgId, role: "owner" }] };
const viewer: Principal = { userId, memberships: [{ organizationId: orgId, role: "viewer" }] };
const finance: Principal = { userId, memberships: [{ organizationId: orgId, role: "finance" }] };
const outsider: Principal = { userId, memberships: [{ organizationId: otherOrgId, role: "owner" }] };
const now = new Date("2026-03-01T00:00:00.000Z");

let sequence = 0;
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    sequence += 1;
    const prefix = kind === "payoutMethod" ? "pmt" : kind === "audit" ? "aud" : "x";
    return `${prefix}_${String(sequence).padStart(26, "0")}` as Id<K>;
  },
};

function ctxFor(principal: Principal): Ctx {
  return { db: undefined as never, clock: { now: () => now }, ids, actor: { type: "user", id: principal.userId } };
}

// Models the adapter contract: a method and its audit row commit together, a publisher outside the organization is not
// found, and a provider account reference is enrolled once.
class MemoryPayoutMethodStore implements PayoutMethodStore {
  publishers = new Map<string, string>([[publisherId, orgId]]);
  writes: PayoutMethodWrite[] = [];
  audits: PayoutMethodWrite["audit"][] = [];
  disabled: string[] = [];

  async insert(write: PayoutMethodWrite) {
    if (this.publishers.get(write.record.publisherId) !== write.organizationId) return "unknown_publisher" as const;
    const taken = this.writes.some(
      (row) =>
        row.record.provider === write.record.provider &&
        row.record.providerAccountRef === write.record.providerAccountRef,
    );
    if (taken) return "duplicate" as const;
    this.writes.push(write);
    this.audits.push(write.audit);
    return "created" as const;
  }

  async listForOrganization(organizationId: Id<"organization">) {
    return this.writes
      .filter((row) => row.organizationId === organizationId)
      .map((row) => ({
        ...row.record,
        state: this.disabled.includes(row.record.id) ? ("disabled" as const) : row.record.state,
      }));
  }

  async disable(input: {
    organizationId: Id<"organization">;
    id: Id<"payoutMethod">;
    at: Date;
    audit: PayoutMethodWrite["audit"];
  }) {
    const row = this.writes.find(
      (write) => write.record.id === input.id && write.organizationId === input.organizationId,
    );
    if (!row) return "not_found" as const;
    if (this.disabled.includes(input.id)) return "already_disabled" as const;
    this.disabled.push(input.id);
    this.audits.push(input.audit);
    return "disabled" as const;
  }
}

const valid = {
  provider: "acme_pay",
  provider_account_ref: "acct_hosted_7f3a",
  country: "NL",
  currency: "EUR",
};

describe("payout method enrollment (TP-W7-007, WP-7.5)", () => {
  test("a hosted enrollment returns an active method with the provider reference only", async () => {
    const store = new MemoryPayoutMethodStore();
    const result = await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, valid);

    expect(result).toEqual({
      ok: true,
      value: {
        id: expect.stringMatching(/^pmt_/),
        publisherId,
        provider: "acme_pay",
        providerAccountRef: "acct_hosted_7f3a",
        country: "NL",
        currency: "EUR",
        state: "active",
        verifiedAt: now,
        createdAt: now,
      },
    });
    expect(store.writes[0]?.record.state).toBe("active");
    expect(store.audits.map((audit) => audit.action)).toEqual(["payout_method.enrolled"]);
  });

  test("the audit row carries identifiers only, never the provider account reference", async () => {
    const store = new MemoryPayoutMethodStore();
    await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, valid);
    expect(JSON.stringify(store.audits)).not.toContain("acct_hosted_7f3a");
  });

  test("a provider account reference already enrolled is a conflict", async () => {
    const store = new MemoryPayoutMethodStore();
    await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, valid);
    const again = await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, valid);
    expect(again).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(1);
  });

  test("a publisher outside the caller's organization is not found, and nothing is written", async () => {
    const store = new MemoryPayoutMethodStore();
    const result = await enrollPayoutMethod(
      ctxFor(outsider),
      { store },
      outsider,
      { organizationId: otherOrgId },
      publisherId,
      valid,
    );
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(store.writes).toHaveLength(0);
  });

  test("a malformed publisher id is not found", async () => {
    const store = new MemoryPayoutMethodStore();
    const result = await enrollPayoutMethod(
      ctxFor(owner),
      { store },
      owner,
      scope,
      "not-an-id" as Id<"publisher">,
      valid,
    );
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("a finance user can enroll; a viewer cannot", async () => {
    const store = new MemoryPayoutMethodStore();
    const ok = await enrollPayoutMethod(ctxFor(finance), { store }, finance, scope, publisherId, valid);
    expect(ok.ok).toBe(true);
  });

  test("a viewer cannot enroll a method", async () => {
    const store = new MemoryPayoutMethodStore();
    const result = await enrollPayoutMethod(ctxFor(viewer), { store }, viewer, scope, publisherId, valid);
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(store.writes).toHaveLength(0);
  });

  test("a caller acting as another user is unauthenticated", async () => {
    const store = new MemoryPayoutMethodStore();
    const ctx = { ...ctxFor(owner), actor: { type: "user", id: "usr_01brz3ndektsv4rrffq69g5fav" } };
    const result = await enrollPayoutMethod(ctx, { store }, owner, scope, publisherId, valid);
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  test.each([
    ["an account number", { ...valid, account_number: "NL91ABNA0417164300" }],
    ["an IBAN", { ...valid, iban: "NL91ABNA0417164300" }],
    ["a bank routing number", { ...valid, routing_number: "021000021" }],
    ["a credential", { ...valid, credential: "sk_live_9f2c7a51d0e84b3c" }],
  ])("TP-W7-008: %s in the body is rejected before anything is stored", async (_label, body) => {
    const store = new MemoryPayoutMethodStore();
    const result = await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, body);
    expect(result.ok).toBe(false);
    expect(store.writes).toHaveLength(0);
    expect(JSON.stringify(result)).not.toMatch(/NL91ABNA|021000021|sk_live/);
  });

  test.each([
    ["provider missing", { ...valid, provider: undefined }],
    ["provider with capitals", { ...valid, provider: "Acme" }],
    ["reference missing", { ...valid, provider_account_ref: undefined }],
    ["reference with spaces", { ...valid, provider_account_ref: "acct 7f3a" }],
    ["country not ISO alpha-2", { ...valid, country: "NLD" }],
    ["unknown currency", { ...valid, currency: "XXZ" }],
    ["body is not an object", "NL91ABNA0417164300"],
  ])("%s is a validation failure", async (_label, body) => {
    const store = new MemoryPayoutMethodStore();
    const result = await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, body);
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
  });
});

describe("payout method listing and disabling (UI-047)", () => {
  test("listing returns the organization's methods and needs payouts:read", async () => {
    const store = new MemoryPayoutMethodStore();
    await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, valid);

    const listed = await listPayoutMethods(ctxFor(finance), { store }, finance, scope);
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.map((method) => method.providerAccountRef)).toEqual(["acct_hosted_7f3a"]);

    const viewerList = await listPayoutMethods(ctxFor(viewer), { store }, viewer, scope);
    expect(viewerList).toEqual({ ok: false, code: "FORBIDDEN" });

    const outside = await listPayoutMethods(ctxFor(outsider), { store }, outsider, scope);
    expect(outside).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  test("disabling an active method audits the change once; a repeat is a no-op", async () => {
    const store = new MemoryPayoutMethodStore();
    const created = await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, valid);
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    const first = await disablePayoutMethod(ctxFor(owner), { store }, owner, scope, id);
    const second = await disablePayoutMethod(ctxFor(owner), { store }, owner, scope, id);
    expect(first).toEqual({ ok: true, value: { id, state: "disabled" } });
    expect(second).toEqual({ ok: true, value: { id, state: "disabled" } });
    expect(store.audits.map((audit) => audit.action)).toEqual(["payout_method.enrolled", "payout_method.disabled"]);
  });

  test("disabling a method outside the organization is not found", async () => {
    const store = new MemoryPayoutMethodStore();
    const created = await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, valid);
    if (!created.ok) throw new Error("setup failed");
    const result = await disablePayoutMethod(
      ctxFor(outsider),
      { store },
      outsider,
      { organizationId: otherOrgId },
      created.value.id,
    );
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("a viewer cannot disable a method", async () => {
    const store = new MemoryPayoutMethodStore();
    const created = await enrollPayoutMethod(ctxFor(owner), { store }, owner, scope, publisherId, valid);
    if (!created.ok) throw new Error("setup failed");
    const result = await disablePayoutMethod(ctxFor(viewer), { store }, viewer, scope, created.value.id);
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});
