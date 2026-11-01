import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createFakeRakuten,
  FAKE_ACCOUNT_ID,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
} from "@moneytrap/adapter-network-rakuten/src/fake-rakuten";
import { createCatalogSyncStore, migrate } from "@moneytrap/adapter-postgres";
import type { CatalogSyncStore } from "@moneytrap/app/src/ports/catalog-sync-store";
import type { NetworkAccountView } from "@moneytrap/app/src/ports/network-account-store";
import type { NetworkConnector } from "@moneytrap/app/src/ports/network-connector";
import type { SealedSecret, SecretBox } from "@moneytrap/app/src/ports/secret-box";
import type { Id } from "@moneytrap/domain";
import { FakeCatalogSyncStore, FakeClock, FakeIdGenerator, RecordedNetworkSimulator } from "@moneytrap/test-kit";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { runCatalogSync } from "./sync";

const NETWORK = "net_worker";
const clock = () => new FakeClock("2026-10-01T06:00:00.000Z");
const ACCOUNT_ID = "nac_01arz3ndektsv4rrffq69g5fav" as Id<"networkAccount">;
const ACCOUNT_REF = "4242";
const STORED_CREDENTIALS = {
  clientId: "worker-client-secret-id",
  clientSecret: "worker-client-secret",
  web_security_token: "advanced-report-token-sentinel",
};

function workerOptions(
  connector?: NetworkConnector,
  catalogStore: CatalogSyncStore = new FakeCatalogSyncStore(),
  accountId: Id<"networkAccount"> = ACCOUNT_ID,
  credentials = STORED_CREDENTIALS,
  accountRef = ACCOUNT_REF,
) {
  const account: NetworkAccountView = {
    id: accountId,
    networkId: NETWORK,
    accountRef,
    state: "unverified",
    lastCheckedAt: null,
    createdAt: clock().now(),
  };
  const sealed: SealedSecret = { keyId: "worker-key", ciphertext: JSON.stringify(credentials) };
  const openedContexts: string[] = [];
  const readIds: string[] = [];
  const constructed: Array<{ credentials: Record<string, string | number | boolean>; accountRef: string }> = [];
  const secretBox: SecretBox = {
    seal() {
      throw new Error("worker must not seal credentials");
    },
    open(value, context) {
      openedContexts.push(context);
      return value.ciphertext;
    },
  };
  return {
    options: {
      store: catalogStore,
      clock: clock(),
      ids: new FakeIdGenerator(),
      networkAccounts: {
        async listForNetwork(networkId: string) {
          return networkId === NETWORK ? [account] : [];
        },
        async readSealedCredential(id: Id<"networkAccount">) {
          readIds.push(id);
          return id === accountId ? sealed : null;
        },
      },
      secretBox,
      ...(connector
        ? {
            createConnector(credentials: Record<string, string | number | boolean>, accountRef: string) {
              constructed.push({ credentials, accountRef });
              return connector;
            },
          }
        : {}),
    },
    accountId,
    openedContexts,
    readIds,
    constructed,
  };
}

describe("catalog sync worker (TP-W4-004, TP-W4-037, TP-W4-038)", () => {
  test("a temporarily_unavailable page is retried after the upstream's retry-after, then resumes", async () => {
    const waits: number[] = [];
    const upstream = new RecordedNetworkSimulator("sync-interrupt");
    const worker = workerOptions(upstream);
    const result = await runCatalogSync(
      {
        ...worker.options,
        sleep: async (ms: number) => {
          waits.push(ms);
        },
      },
      NETWORK,
      worker.accountId,
    );

    expect(result.ok).toBe(true);
    expect(waits).toEqual([30_000]);
    expect(worker.readIds).toEqual([worker.accountId]);
    expect(worker.openedContexts).toEqual([worker.accountId]);
    expect(worker.constructed).toEqual([
      {
        credentials: { clientId: STORED_CREDENTIALS.clientId, clientSecret: STORED_CREDENTIALS.clientSecret },
        accountRef: ACCOUNT_REF,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("worker-client-secret");
    expect(JSON.stringify(result)).not.toContain("advanced-report-token-sentinel");
  });

  test("a disabled credential is not retried", async () => {
    const waits: number[] = [];
    const worker = workerOptions(new RecordedNetworkSimulator("disabled-credential"));
    const result = await runCatalogSync(
      {
        ...worker.options,
        sleep: async (ms: number) => {
          waits.push(ms);
        },
      },
      NETWORK,
      worker.accountId,
    );

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(waits).toEqual([]);
  });

  test("TP-W4-037 an unknown stored account does not open a credential or construct a connector", async () => {
    const worker = workerOptions(new RecordedNetworkSimulator("clean-catalog"));
    worker.options.networkAccounts.listForNetwork = async () => [];
    const result = await runCatalogSync(worker.options, NETWORK, worker.accountId);

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(worker.readIds).toEqual([]);
    expect(worker.openedContexts).toEqual([]);
    expect(worker.constructed).toEqual([]);
  });

  test("TP-W4-038 default worker connector uses stored credentials and account_ref without the reports token", async () => {
    const upstream = createFakeRakuten({ now: () => new Date("2026-10-01T06:00:00.000Z") });
    const worker = workerOptions(
      undefined,
      new FakeCatalogSyncStore(),
      ACCOUNT_ID,
      { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, web_security_token: "never-used-by-sync-token" },
      FAKE_ACCOUNT_ID,
    );
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: upstream.fetch });
    try {
      const result = await runCatalogSync(worker.options, NETWORK, worker.accountId);
      expect(result.ok).toBe(true);
    } finally {
      if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
    }
    expect(
      upstream.requests.some(
        (request) => request.path === "/token" && request.body?.includes(`scope=${FAKE_ACCOUNT_ID}`),
      ),
    ).toBe(true);
    expect(worker.openedContexts).toEqual([ACCOUNT_ID]);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("catalog sync worker against Postgres (CT-015)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    schema = `worker_sync_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    // network_advertisers references networks (WP-4.4), so the test network must exist first.
    await sql`insert into networks (id, code, name, created_at, updated_at)
      values (${NETWORK}, ${NETWORK}, ${NETWORK}, now(), now())`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const teardown = new Pool({ connectionString: databaseUrl });
    await teardown.query(`drop schema "${schema}" cascade`);
    await teardown.end();
  });

  test("a malformed program is quarantined, never stored as a program, and the rest of the catalog syncs", async () => {
    const worker = workerOptions(new RecordedNetworkSimulator("malformed-records"), createCatalogSyncStore(db));
    const result = await runCatalogSync(worker.options, NETWORK, worker.accountId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.programs.quarantined).toBe(1);
    const programs = await sql<{ n: string }>`select count(*)::text as n from programs`.execute(db);
    expect(programs.rows[0]?.n).toBe("2");
    const held = await sql<{ n: string }>`select count(*)::text as n from catalog_quarantine`.execute(db);
    expect(held.rows[0]?.n).toBe("1");
  });
});
