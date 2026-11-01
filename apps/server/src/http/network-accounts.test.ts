import { describe, expect, test } from "bun:test";
import { RakutenConnector } from "@moneytrap/adapter-network-rakuten";
import {
  createFakeRakuten,
  FAKE_ACCOUNT_ID,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
} from "@moneytrap/adapter-network-rakuten/src/fake-rakuten";
import type { Ctx } from "@moneytrap/app/src/ctx";
import type {
  NetworkAccountStore,
  NetworkAccountView,
  NetworkAccountWrite,
} from "@moneytrap/app/src/ports/network-account-store";
import type { SealedSecret, SecretBox } from "@moneytrap/app/src/ports/secret-box";
import type { Id, IdKind, Role } from "@moneytrap/domain";
import { createApp } from "../app";
import type { PrincipalResolver } from "./guards/enforce";
import { networkAccountRoutes } from "./network-accounts";

const userId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const networkId = "net_test_one";
let seq = 0;
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    seq += 1;
    return `${kind === "networkAccount" ? "nac" : "aud"}_${String(seq).padStart(26, "0")}` as Id<K>;
  },
};
const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

class Store implements NetworkAccountStore {
  writes = 0;
  reads = 0;
  found = true;
  findId?: Id<"networkAccount">;
  sealed: SealedSecret | null = null;
  write?: NetworkAccountWrite;
  rotation?: { id: Id<"networkAccount">; sealed: SealedSecret };
  accountId = "nac_01arz3ndektsv4rrffq69g5fav" as Id<"networkAccount">;
  connectionAccountRef = "partner-7731";
  async insert(write: NetworkAccountWrite) {
    this.writes++;
    this.write = write;
    return "created" as const;
  }
  async listForNetwork(): Promise<NetworkAccountView[]> {
    return [];
  }
  async readSealedCredential(): Promise<SealedSecret | null> {
    return null;
  }
  async findForConnection(id: Id<"networkAccount">) {
    this.reads++;
    this.findId = id;
    return this.found && id === accountId && this.sealed
      ? { accountRef: this.connectionAccountRef, sealedCredential: this.sealed }
      : null;
  }
  async rotateCredential(id: Id<"networkAccount">, sealedCredential: SealedSecret): Promise<NetworkAccountView | null> {
    this.writes++;
    this.rotation = { id, sealed: sealedCredential };
    return {
      id,
      networkId,
      accountRef: "partner-7731",
      state: "unverified",
      lastCheckedAt: null,
      createdAt: clock.now(),
    };
  }
}

function fixture(
  globalRole: string | null,
  memberships: readonly { organizationId: Id<"organization">; role: Role }[] = [],
  stored?: { clientId: string; clientSecret: string; web_security_token?: string },
  useProductionConnector = false,
) {
  const store = new Store();
  let seals = 0;
  const upstream = createFakeRakuten({ now: () => clock.now() });
  let opens = 0;
  if (stored) store.sealed = { keyId: "test-key", ciphertext: Buffer.from(JSON.stringify(stored)).toString("base64") };
  const secretBox: SecretBox = {
    seal(plaintext, context) {
      seals++;
      return { keyId: "test-key", ciphertext: Buffer.from(`${context}:${plaintext}`).toString("base64") };
    },
    open(sealed) {
      opens++;
      return Buffer.from(sealed.ciphertext, "base64").toString();
    },
  };
  const principal: PrincipalResolver = async () =>
    globalRole === null && memberships.length === 0 ? null : { userId, memberships, globalRole };
  const server = createApp({ clock, ids, readiness: [] }).use(
    networkAccountRoutes({
      db: undefined as unknown as Ctx["db"],
      store,
      secretBox,
      clock,
      ids,
      principal,
      ...(useProductionConnector
        ? {}
        : {
            createConnector: (
              credentials: Record<string, string | number | boolean>,
              accountRef: string,
              connectorClock: typeof clock,
            ) =>
              new RakutenConnector({
                clientId: String(credentials.clientId),
                clientSecret: String(credentials.clientSecret),
                accountId: accountRef,
                clock: connectorClock,
                fetch: upstream.fetch,
              }),
          }),
    }),
  );
  return {
    server,
    store,
    get seals() {
      return seals;
    },
    get opens() {
      return opens;
    },
    upstream,
  };
}

const accountId = ids.next("networkAccount");
const payload = {
  network_id: networkId,
  account_ref: "partner-7731",
  credentials: { clientId: "client-id-safe", clientSecret: "secret-must-not-return" },
};
const send = (server: ReturnType<typeof fixture>["server"]) =>
  server.handle(
    new Request("http://localhost/v1/admin/network-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

describe("POST /v1/admin/network-accounts (API-111, TP-W4-034)", () => {
  test("anonymous caller receives 401 before storing or sealing", async () => {
    const f = fixture(null);
    const response = await send(f.server);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("secret-must-not-return");
    expect(f.store.writes).toBe(0);
    expect(f.seals).toBe(0);
  });

  test("tenant admin receives 403 before storing or sealing", async () => {
    const f = fixture("user", [
      { organizationId: "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">, role: "admin" },
    ]);
    const response = await send(f.server);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("secret-must-not-return");
    expect(f.store.writes).toBe(0);
    expect(f.seals).toBe(0);
  });

  test("global admin receives metadata only", async () => {
    const f = fixture("admin");
    const response = await send(f.server);
    const text = await response.text();
    expect(response.status).toBe(201);
    expect(JSON.parse(text)).toMatchObject({
      data: { network_id: networkId, account_ref: "partner-7731", credential_status: "unverified" },
    });
    expect(text).not.toContain("secret-must-not-return");
    expect(f.store.writes).toBe(1);
    expect(f.seals).toBe(1);
  });
  test("tenant and anonymous callers cannot rotate; denied requests do not write or seal", async () => {
    for (const f of [
      fixture(null),
      fixture("user", [{ organizationId: "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">, role: "admin" }]),
    ]) {
      const response = await f.server.handle(
        new Request(`http://localhost/v1/admin/network-accounts/${accountId}/credentials`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credentials: { clientId: "x", clientSecret: "rotate-secret" } }),
        }),
      );
      expect([401, 403]).toContain(response.status);
      expect(await response.text()).not.toContain("rotate-secret");
      expect(f.store.writes).toBe(0);
      expect(f.seals).toBe(0);
    }
  });

  test("global admin rotates and receives only safe credential metadata", async () => {
    const f = fixture("admin");
    const response = await f.server.handle(
      new Request(`http://localhost/v1/admin/network-accounts/${accountId}/credentials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credentials: { clientId: "client", clientSecret: "rotate-secret" },
        }),
      }),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text).data).toMatchObject({
      id: expect.any(String),
      credential_status: "unverified",
      rotated_at: expect.any(String),
    });
    expect(text).not.toContain("rotate-secret");
    expect(f.store.writes).toBe(1);
    expect(f.seals).toBe(1);
  });

  test("client schema injection and undeclared credential fields are rejected before seal or write", async () => {
    const f = fixture("admin");
    const response = await f.server.handle(
      new Request(`http://localhost/v1/admin/network-accounts/${accountId}/credentials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credential_schema: [{ name: "extra", type: "string", required: true }],
          credentials: { clientId: "client", clientSecret: "no-echo", extra: "widen" },
        }),
      }),
    );
    const text = await response.text();
    expect(response.status).toBe(400);
    expect(text).not.toContain("no-echo");
    expect(f.store.writes).toBe(0);
    expect(f.seals).toBe(0);
  });
  test("tenant and anonymous callers cannot test connections or read/open credentials", async () => {
    for (const f of [
      fixture(null),
      fixture("user", [{ organizationId: "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">, role: "admin" }]),
    ]) {
      const response = await f.server.handle(
        new Request(`http://localhost/v1/admin/network-accounts/${accountId}/test-connection`, { method: "POST" }),
      );
      expect([401, 403]).toContain(response.status);
      expect(f.store.reads).toBe(0);
      expect(f.opens).toBe(0);
    }
  });

  test("global admin gets safe connection status and capability profile", async () => {
    const f = fixture(
      "admin",
      [{ organizationId: "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">, role: "admin" }],
      { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET },
    );
    f.store.connectionAccountRef = FAKE_ACCOUNT_ID;
    const response = await f.server.handle(
      new Request(`http://localhost/v1/admin/network-accounts/${accountId}/test-connection`, { method: "POST" }),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text).data).toMatchObject({ connection_status: "connected", capabilities: expect.any(Object) });
    expect(text).not.toContain("secret");
    expect(f.store.reads).toBe(1);
    expect(f.opens).toBe(1);
    expect(f.store.findId).toBe(accountId);
    expect(f.store.connectionAccountRef).toBe(FAKE_ACCOUNT_ID);
  });

  test("production connector uses provider fetch instead of a fabricated success response", async () => {
    const f = fixture("admin", [], { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET }, true);
    f.store.connectionAccountRef = FAKE_ACCOUNT_ID;
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: f.upstream.fetch });
    try {
      const response = await f.server.handle(
        new Request(`http://localhost/v1/admin/network-accounts/${accountId}/test-connection`, { method: "POST" }),
      );
      expect(response.status).toBe(200);
      expect(JSON.parse(await response.text()).data.connection_status).toBe("connected");
    } finally {
      if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
    }
    expect(f.upstream.requests.length).toBeGreaterThan(0);
    expect(f.store.reads).toBe(1);
    expect(f.opens).toBe(1);
  });
});
