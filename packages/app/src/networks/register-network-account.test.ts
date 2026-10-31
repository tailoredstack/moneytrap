import { describe, expect, test } from "bun:test";
import type { Id, IdKind } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { NetworkAccountStore, NetworkAccountView, NetworkAccountWrite } from "../ports/network-account-store";
import type { SealedSecret, SecretBox } from "../ports/secret-box";
import { registerNetworkAccount } from "./register-network-account";

const credential = "sk_live_9f2c7a51d0e84b3c";
const networkId = "net_test_one";
const operator = { type: "user", id: "usr_01arz3ndektsv4rrffq69g5fav" };
const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

// Stub IDs keep assertions readable. Each call gets a fresh, prefixed body.
let sequence = 0;
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    sequence += 1;
    const prefix = kind === "networkAccount" ? "nac" : kind === "audit" ? "aud" : "x";
    return `${prefix}_${String(sequence).padStart(26, "0")}` as Id<K>;
  },
};

// Models the adapter contract: the account and its audit row commit together, and a duplicate or unknown network writes
// nothing.
class MemoryNetworkAccountStore implements NetworkAccountStore {
  networks = new Set<string>([networkId]);
  accounts = new Map<string, NetworkAccountWrite>();
  audits: NetworkAccountWrite["audit"][] = [];

  async insert(write: NetworkAccountWrite) {
    if (!this.networks.has(write.networkId)) return "unknown_network" as const;
    const taken = [...this.accounts.values()].some(
      (account) => account.networkId === write.networkId && account.accountRef === write.accountRef,
    );
    if (taken) return "duplicate" as const;
    this.accounts.set(write.id, write);
    this.audits.push(write.audit);
    return "created" as const;
  }

  async listForNetwork(): Promise<NetworkAccountView[]> {
    return [];
  }

  async readSealedCredential(id: Id<"networkAccount">): Promise<SealedSecret | null> {
    return this.accounts.get(id)?.sealedCredential ?? null;
  }
}

// Reversible stand-in that binds each value to its context, as the server's AES-GCM box does. It is not secure.
const secretBox: SecretBox = {
  seal: (plaintext, context) => ({
    keyId: "test-key-1",
    ciphertext: Buffer.from(`${context}\n${plaintext}`).toString("base64"),
  }),
  open(sealed, context) {
    const [bound, ...rest] = Buffer.from(sealed.ciphertext, "base64").toString("utf8").split("\n");
    if (bound !== context) throw new Error("secret could not be opened");
    return rest.join("\n");
  },
};

function setup(actor: Ctx["actor"] = operator) {
  const store = new MemoryNetworkAccountStore();
  const deps = { store, secretBox };
  const ctx: Ctx = { db: undefined as never, clock, ids, actor };
  return { store, deps, ctx };
}

const valid = { account_ref: "partner-7731", credential };

describe("register network account (TP-W4-007, WP-4.4)", () => {
  test("registers the account as unverified and returns metadata only", async () => {
    const { store, deps, ctx } = setup();
    const result = await registerNetworkAccount(ctx, deps, networkId, valid);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      id: result.value.id,
      networkId,
      accountRef: "partner-7731",
      state: "unverified",
      lastCheckedAt: null,
      createdAt: ctx.clock.now(),
    });
    expect(store.accounts.get(result.value.id)?.state).toBe("unverified");
  });

  test("the result, its serialized form, and the audit row never contain the credential or its ciphertext", async () => {
    const { store, deps, ctx } = setup();
    const result = await registerNetworkAccount(ctx, deps, networkId, valid);
    if (!result.ok) throw new Error("registration should succeed");

    const sealed = store.accounts.get(result.value.id)?.sealedCredential;
    expect(sealed).toBeDefined();
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(JSON.stringify(result)).not.toContain(sealed?.ciphertext ?? "");
    expect(JSON.stringify(store.audits)).not.toContain(credential);
    expect(JSON.stringify(store.audits)).not.toContain(sealed?.ciphertext ?? "");
  });

  test("the credential is sealed under a key ID and opens only for its own account", async () => {
    const { store, deps, ctx } = setup();
    const result = await registerNetworkAccount(ctx, deps, networkId, valid);
    if (!result.ok) throw new Error("registration should succeed");

    const sealed = await store.readSealedCredential(result.value.id);
    expect(sealed?.keyId).toBe("test-key-1");
    expect(deps.secretBox.open(sealed ?? { keyId: "", ciphertext: "" }, result.value.id)).toBe(credential);
    expect(() => deps.secretBox.open(sealed ?? { keyId: "", ciphertext: "" }, "nac_other")).toThrow(
      "secret could not be opened",
    );
  });

  test("the audit row records the registration with identifiers only", async () => {
    const { store, deps, ctx } = setup();
    const result = await registerNetworkAccount(ctx, deps, networkId, valid);
    if (!result.ok) throw new Error("registration should succeed");

    expect(store.audits).toEqual([
      {
        id: expect.stringMatching(/^aud_/) as unknown as Id<"audit">,
        actor: operator,
        action: "network_account.registered",
        entityId: result.value.id,
        metadata: { networkId, keyId: "test-key-1" },
        occurredAt: ctx.clock.now(),
      },
    ]);
  });

  test("a caller that is not a user is UNAUTHENTICATED and nothing is written", async () => {
    const { store, deps, ctx } = setup({ type: "system", id: null });
    const result = await registerNetworkAccount(ctx, deps, networkId, valid);
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(store.accounts.size).toBe(0);
  });

  test("a blank or missing account reference is VALIDATION_FAILED", async () => {
    const { store, deps, ctx } = setup();
    expect(await registerNetworkAccount(ctx, deps, networkId, { ...valid, account_ref: "  " })).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
      reason: "account_ref is required",
    });
    expect(await registerNetworkAccount(ctx, deps, networkId, { credential })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(store.accounts.size).toBe(0);
  });

  test("a missing or oversized credential is VALIDATION_FAILED, and the reason never echoes it", async () => {
    const { deps, ctx } = setup();
    const missing = await registerNetworkAccount(ctx, deps, networkId, { account_ref: "partner-7731" });
    expect(missing).toEqual({ ok: false, code: "VALIDATION_FAILED", reason: "credential is required" });

    const oversized = await registerNetworkAccount(ctx, deps, networkId, {
      account_ref: "partner-7731",
      credential: "x".repeat(4097),
    });
    expect(oversized).toEqual({ ok: false, code: "VALIDATION_FAILED", reason: "credential is too long" });
    expect(
      JSON.stringify(await registerNetworkAccount(ctx, deps, networkId, { ...valid, account_ref: "" })),
    ).not.toContain(credential);
  });

  test("an unknown network is RESOURCE_NOT_FOUND", async () => {
    const { store, deps, ctx } = setup();
    expect(await registerNetworkAccount(ctx, deps, "net_missing", valid)).toEqual({
      ok: false,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(store.accounts.size).toBe(0);
  });

  test("a second account with the same reference on one network is STATE_CONFLICT", async () => {
    const { store, deps, ctx } = setup();
    await registerNetworkAccount(ctx, deps, networkId, valid);
    expect(await registerNetworkAccount(ctx, deps, networkId, valid)).toEqual({
      ok: false,
      code: "STATE_CONFLICT",
    });
    expect(store.accounts.size).toBe(1);
  });
});
