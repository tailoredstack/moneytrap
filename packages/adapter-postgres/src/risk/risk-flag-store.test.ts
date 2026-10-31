import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { recordClick } from "@moneytrap/app/src/attribution/record-click";
import type { ClickObservation } from "@moneytrap/app/src/ports/click-store";
import { flagBaselineRisks } from "@moneytrap/app/src/risk/flag-clicks";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { createClickStore } from "../attribution/click-store";
import { migrate } from "../migrate";
import { createRiskFlagStore } from "./risk-flag-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const linkId = "lnk_01arz3ndektsv4rrffq69g5fav";
const occurredAt = new Date("2026-03-01T10:00:00.000Z");
const click = (dedupKey: string, at = occurredAt): ClickObservation => ({ dedupKey, linkId, occurredAt: at });
const since = new Date("2026-03-01T00:00:00.000Z");

describeWithDatabase("risk flag store (TP-W5-038, DM-060, WP-5.10)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `risk_flags_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
  });

  afterEach(async () => {
    await db.destroy();
    const teardown = new Pool({ connectionString: databaseUrl });
    await teardown.query(`drop schema "${schema}" cascade`);
    await teardown.end();
  });

  const flagRows = async () =>
    (
      await sql<{ link_id: string; rule_code: string; subject_key: string; severity: string; state: string }>`
      select link_id, rule_code, subject_key, severity, state from risk_flags
    `.execute(db)
    ).rows;

  const clickCount = async () =>
    (await sql<{ n: number }>`select count(*)::int as n from clicks`.execute(db)).rows[0]?.n;

  test("a duplicate-click burst raises one open flag and every click stays counted (TP-W5-038)", async () => {
    const clicks = createClickStore(db);
    await recordClick(clicks, click("click:a"));
    await recordClick(clicks, click("click:b"));

    expect(await flagBaselineRisks(createRiskFlagStore(db), { since })).toEqual({ raised: 1, existing: 0 });
    expect(await flagRows()).toEqual([
      {
        link_id: linkId,
        rule_code: "duplicate_click",
        subject_key: occurredAt.toISOString(),
        severity: "review",
        state: "open",
      },
    ]);
    expect(await clickCount()).toBe(2);
  });

  test("rescanning the same clicks keeps one flag (idempotent)", async () => {
    const clicks = createClickStore(db);
    await recordClick(clicks, click("click:a"));
    await recordClick(clicks, click("click:b"));

    const store = createRiskFlagStore(db);
    await flagBaselineRisks(store, { since });
    expect(await flagBaselineRisks(store, { since })).toEqual({ raised: 0, existing: 1 });
    expect(await flagRows()).toHaveLength(1);
  });

  test("two distinct clicks a second apart are legitimate and raise nothing", async () => {
    const clicks = createClickStore(db);
    await recordClick(clicks, click("click:a"));
    await recordClick(clicks, click("click:b", new Date(occurredAt.getTime() + 1000)));

    expect(await flagBaselineRisks(createRiskFlagStore(db), { since })).toEqual({ raised: 0, existing: 0 });
    expect(await flagRows()).toEqual([]);
    expect(await clickCount()).toBe(2);
  });

  test("bursts before the window are not flagged", async () => {
    const clicks = createClickStore(db);
    await recordClick(clicks, click("click:a"));
    await recordClick(clicks, click("click:b"));

    const later = new Date("2026-03-02T00:00:00.000Z");
    expect(await flagBaselineRisks(createRiskFlagStore(db), { since: later })).toEqual({ raised: 0, existing: 0 });
    expect(await flagRows()).toEqual([]);
  });
});
