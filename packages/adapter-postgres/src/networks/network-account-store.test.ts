import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { NetworkAccountWrite } from "@moneytrap/app/src/ports/network-account-store";
import type { Id } from "@moneytrap/domain";
import { FakeSecretBox } from "@moneytrap/test-kit";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createNetworkAccountStore } from "./network-account-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const credential = "sk_live_9f2c7a51d0e84b3c";
const networkId = "net_test_one";
const createdAt = new Date("2026-10-01T12:00:00.000Z");
const operator = { type: "user", id: "usr_01arz3ndektsv4rrffq69g5fav" };

function writeFor(id: string, accountRef: string, network = networkId): NetworkAccountWrite {
  const sealedCredential = new FakeSecretBox().seal(credential, id);
  return {
    id: id as Id<"networkAccount">,
    networkId: network,
    accountRef,
    sealedCredential,
    state: "unverified",
    createdAt,
    audit: {
      id: `aud_${id}` as Id<"audit">,
      actor: operator,
      action: "network_account.registered",
      entityId: id as Id<"networkAccount">,
      metadata: { networkId: network, keyId: sealedCredential.keyId },
      occurredAt: createdAt,
    },
  };
}

describeWithDatabase("network account store (TP-W4-007, WP-4.4)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `network_account_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`insert into networks (id, code, name, created_at, updated_at)
      values (${networkId}, 'partner-one', 'Partner One', now(), now())`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  test("a new account and its audit row commit together, and the audit row holds no credential", async () => {
    const store = createNetworkAccountStore(db);
    expect(await store.insert(writeFor("nac_one", "partner-7731"))).toBe("created");

    const audits = await sql<{ organization_id: string | null; action: string; metadata: unknown }>`
      select organization_id, action, metadata from audit_logs where entity_type = 'network_account'
    `.execute(db);
    expect(audits.rows).toEqual([
      {
        organization_id: null,
        action: "network_account.registered",
        metadata: { networkId, keyId: FakeSecretBox.keyId },
      },
    ]);
  });

  test("the row stores ciphertext and its key ID, never the credential", async () => {
    const store = createNetworkAccountStore(db);
    await store.insert(writeFor("nac_one", "partner-7731"));

    const rows = await sql<{ credential_ciphertext: string; credential_key_id: string }>`
      select credential_ciphertext, credential_key_id from network_accounts where id = 'nac_one'
    `.execute(db);
    expect(rows.rows[0]?.credential_key_id).toBe(FakeSecretBox.keyId);
    expect(rows.rows[0]?.credential_ciphertext).not.toContain(credential);
  });

  test("a scan of every account and audit row finds no credential (TP-W4-007)", async () => {
    const store = createNetworkAccountStore(db);
    await store.insert(writeFor("nac_one", "partner-7731"));

    const stored = await sql`select * from network_accounts`.execute(db);
    const audit = await sql`select * from audit_logs`.execute(db);
    expect(JSON.stringify(stored.rows)).not.toContain(credential);
    expect(JSON.stringify(audit.rows)).not.toContain(credential);
  });

  test("a second account with the same reference on one network is a duplicate and writes nothing", async () => {
    const store = createNetworkAccountStore(db);
    await store.insert(writeFor("nac_one", "partner-7731"));
    expect(await store.insert(writeFor("nac_two", "partner-7731"))).toBe("duplicate");

    const count = await sql<{ n: string }>`select count(*)::text as n from audit_logs`.execute(db);
    expect(count.rows[0]?.n).toBe("1");
  });

  test("an unknown network writes nothing", async () => {
    const store = createNetworkAccountStore(db);
    expect(await store.insert(writeFor("nac_orphan", "partner-7731", "net_missing"))).toBe("unknown_network");

    const count = await sql<{ n: string }>`select count(*)::text as n from network_accounts`.execute(db);
    expect(count.rows[0]?.n).toBe("0");
  });

  test("the list view carries no credential or ciphertext field (TP-W4-007)", async () => {
    const store = createNetworkAccountStore(db);
    await store.insert(writeFor("nac_one", "partner-7731"));

    const [view] = await store.listForNetwork(networkId);
    expect(Object.keys(view ?? {}).sort()).toEqual(
      ["accountRef", "createdAt", "id", "lastCheckedAt", "networkId", "state"].sort(),
    );
    expect(JSON.stringify(view)).not.toContain(credential);
  });

  test("rotation replaces ciphertext and writes immutable network audit metadata while reads stay safe", async () => {
    const store = createNetworkAccountStore(db);
    await store.insert(writeFor("nac_one", "partner-7731"));
    const replacement = new FakeSecretBox().seal("rotated-secret", "nac_one");
    const view = await store.rotateCredential("nac_one" as Id<"networkAccount">, replacement, {
      id: "aud_rotate" as Id<"audit">,
      actor: operator,
      action: "network_account.rotated",
      entityId: "nac_one" as Id<"networkAccount">,
      metadata: { keyId: replacement.keyId },
      occurredAt: createdAt,
    });
    expect(view?.networkId).toBe(networkId);
    expect(Object.keys(view ?? {}).sort()).toEqual(
      ["accountRef", "createdAt", "id", "lastCheckedAt", "networkId", "state"].sort(),
    );
    expect(await store.readSealedCredential("nac_one" as Id<"networkAccount">)).toEqual(replacement);
    expect(JSON.stringify(await store.listForNetwork(networkId))).not.toContain("rotated-secret");
    const audits = await sql<{
      action: string;
      metadata: unknown;
    }>`select action, metadata from audit_logs where action = 'network_account.rotated'`.execute(db);
    expect(audits.rows).toEqual([
      { action: "network_account.rotated", metadata: { networkId, keyId: replacement.keyId } },
    ]);
    expect(
      await store.rotateCredential("nac_missing" as Id<"networkAccount">, replacement, {
        id: "aud_missing" as Id<"audit">,
        actor: operator,
        action: "network_account.rotated",
        entityId: "nac_missing" as Id<"networkAccount">,
        metadata: { keyId: replacement.keyId },
        occurredAt: createdAt,
      }),
    ).toBeNull();
  });

  test("the sync path opens the sealed credential for the account it was sealed for", async () => {
    const store = createNetworkAccountStore(db);
    const write = writeFor("nac_one", "partner-7731");
    await store.insert(write);

    const sealed = await store.readSealedCredential("nac_one" as Id<"networkAccount">);
    expect(sealed).toEqual(write.sealedCredential);
    // Opening the value under its own account proves the stored ciphertext is the one that was sealed.
    expect(sealed ? new FakeSecretBox().open(sealed, "nac_one") : null).toBe(credential);
    expect(await store.readSealedCredential("nac_missing" as Id<"networkAccount">)).toBeNull();
  });
});
