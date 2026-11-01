import { describe, expect, test } from "bun:test";
import type { Id, IdKind } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type {
  NetworkAccountAudit,
  NetworkAccountStore,
  NetworkAccountView,
  NetworkAccountWrite,
} from "../ports/network-account-store";
import type { SealedSecret, SecretBox } from "../ports/secret-box";
import { rotateNetworkAccount } from "./rotate-network-account";

const accountId = "nac_01arz3ndektsv4rrffq69g5fav";
const credentialSecret = "rotation-secret-do-not-echo";
let seq = 0;
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    seq++;
    return `${kind === "audit" ? "aud" : "nac"}_${String(seq).padStart(26, "0")}` as Id<K>;
  },
};
const ctx: Ctx = {
  db: undefined as never,
  clock: { now: () => new Date("2026-01-01Z") },
  ids,
  actor: { type: "user", id: "usr_01arz3ndektsv4rrffq69g5fav" },
};
const anon: Ctx = { ...ctx, actor: { type: "system", id: null } };
const view: NetworkAccountView = {
  id: accountId as Id<"networkAccount">,
  networkId: "net_one",
  accountRef: "partner-1",
  state: "unverified",
  lastCheckedAt: null,
  createdAt: new Date("2026-01-01Z"),
};
class Store implements NetworkAccountStore {
  writes = 0;
  found = true;
  sealed: SealedSecret | null = null;
  audit?: NetworkAccountAudit;
  async insert(_write: NetworkAccountWrite) {
    return "created" as const;
  }
  async listForNetwork() {
    return [];
  }
  async readSealedCredential() {
    return this.sealed;
  }
  async findForConnection() {
    return null;
  }
  async rotateCredential(_id: Id<"networkAccount">, secret: SealedSecret, audit: NetworkAccountAudit) {
    this.writes++;
    this.sealed = secret;
    this.audit = { ...audit, metadata: { ...audit.metadata, networkId: view.networkId } };
    return this.found ? view : null;
  }
}
function setup() {
  const store = new Store();
  let seals = 0;
  const secretBox: SecretBox = {
    seal(plaintext, context) {
      seals++;
      return { keyId: "key", ciphertext: Buffer.from(`${context}:${plaintext}`).toString("base64") };
    },
    open() {
      return "";
    },
  };
  return {
    store,
    deps: { store, secretBox },
    get seals() {
      return seals;
    },
  };
}
const input = {
  accountId,
  credential: { access_token: credentialSecret },
  credentialSchema: [{ name: "access_token", type: "string" as const, required: true }],
};
describe("rotate network account", () => {
  test("seals account-bound credentials, audits without secret, and returns metadata only", async () => {
    const f = setup();
    const result = await rotateNetworkAccount(ctx, f.deps, input);
    expect(result).toEqual({ ok: true, value: view });
    expect(f.store.writes).toBe(1);
    expect(f.seals).toBe(1);
    expect(f.store.sealed?.ciphertext).not.toContain(credentialSecret);
    expect(JSON.stringify(f.store.audit)).not.toContain(credentialSecret);
    expect(JSON.stringify(result)).not.toContain(credentialSecret);
    expect(f.store.audit?.action).toBe("network_account.rotated");
    expect(f.store.audit?.metadata).toEqual({ networkId: view.networkId, keyId: "key" });
  });
  test("unknown account returns RESOURCE_NOT_FOUND", async () => {
    const f = setup();
    f.store.found = false;
    expect(await rotateNetworkAccount(ctx, f.deps, input)).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });
  test("invalid or undeclared fields are rejected without echo or write", async () => {
    const f = setup();
    const secret = "must-not-echo";
    const result = await rotateNetworkAccount(ctx, f.deps, { ...input, credential: { unexpected: secret } });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(f.store.writes).toBe(0);
    expect(f.seals).toBe(0);
  });
  test("anonymous actor is rejected before sealing or writing", async () => {
    const f = setup();
    expect(await rotateNetworkAccount(anon, f.deps, input)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(f.store.writes).toBe(0);
    expect(f.seals).toBe(0);
  });
});
