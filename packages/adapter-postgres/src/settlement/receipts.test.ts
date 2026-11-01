import { describe, expect, test } from "bun:test";
import type { ReceiptRecord } from "@moneytrap/app/src/ports/settlement-receipt-store";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createSettlementReceiptStore } from "./receipts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

// Each test gets a private schema with the migrations applied and one network, so the receipt foreign key holds.
async function openPostgres() {
  const schema = `settlement_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema "${schema}"`);
  await admin.end();

  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  await migrate(db);
  await sql`insert into networks (id, code, name, created_at, updated_at)
    values ('net_one', 'one', 'Network one', now(), now())`.execute(db);

  return {
    store: createSettlementReceiptStore(db),
    db,
    async close() {
      await db.destroy();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`drop schema if exists "${schema}" cascade`);
      await cleanup.end();
    },
  };
}

function receipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: "str_01hzzzzzzzzzzzzzzzzzzzzzza" as ReceiptRecord["id"],
    networkId: "net_one",
    externalRef: "rcpt-1",
    grossMinor: 9_007_199_254_740_993n,
    currency: "USD",
    receivedAt: new Date("2026-10-31T09:00:00.000Z"),
    state: "cleared",
    objectRef: "upload:1",
    ...overrides,
  };
}

describeWithDatabase("settlement receipts in Postgres (DM-041, TP-W7-001)", () => {
  test("stores a receipt and returns it unchanged when the same reference arrives again", async () => {
    const fixture = await openPostgres();
    try {
      const first = await fixture.store.record(receipt());
      const again = await fixture.store.record(
        receipt({ id: "str_01hzzzzzzzzzzzzzzzzzzzzzzb" as ReceiptRecord["id"], objectRef: "upload:2" }),
      );

      expect(first).toEqual({ kind: "created" });
      expect(again.kind).toBe("existing");
      if (again.kind !== "existing") return;
      expect(again.existing).toMatchObject({
        id: "str_01hzzzzzzzzzzzzzzzzzzzzzza",
        grossMinor: 9_007_199_254_740_993n,
        objectRef: "upload:1",
      });
    } finally {
      await fixture.close();
    }
  });

  test("keeps bigint minor units exact above the Number safe range", async () => {
    const fixture = await openPostgres();
    try {
      await fixture.store.record(receipt());

      const stored = await sql<{ gross_minor: string }>`select gross_minor from settlement_receipts`.execute(
        fixture.db,
      );
      expect(stored.rows).toEqual([{ gross_minor: "9007199254740993" }]);
    } finally {
      await fixture.close();
    }
  });

  test("the same reference from another network is a separate receipt", async () => {
    const fixture = await openPostgres();
    try {
      await sql`insert into networks (id, code, name, created_at, updated_at)
        values ('net_two', 'two', 'Network two', now(), now())`.execute(fixture.db);
      await fixture.store.record(receipt());

      const other = await fixture.store.record(
        receipt({ id: "str_01hzzzzzzzzzzzzzzzzzzzzzzc" as ReceiptRecord["id"], networkId: "net_two" }),
      );

      expect(other).toEqual({ kind: "created" });
    } finally {
      await fixture.close();
    }
  });

  test("rejects a negative amount at the database", async () => {
    const fixture = await openPostgres();
    try {
      await expect(fixture.store.record(receipt({ grossMinor: -1n }))).rejects.toThrow();
    } finally {
      await fixture.close();
    }
  });
});
