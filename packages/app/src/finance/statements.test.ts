import { describe, expect, test } from "bun:test";
import { createShareRule, type Id, type IdKind } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { IdGenerator } from "../ports/id-generator";
import type { BalanceConversion, PublisherBalanceSource } from "../ports/publisher-balance-source";
import type { StatementRecord, StatementStore } from "../ports/statement-store";
import { closeStatement, listStatements, statementHash } from "./statements";

const publisherId = `pub_${"1".padStart(26, "0")}` as Id<"publisher">;
const otherPublisherId = `pub_${"2".padStart(26, "0")}` as Id<"publisher">;
const periodStart = new Date("2026-10-01T00:00:00.000Z");
const periodEnd = new Date("2026-11-01T00:00:00.000Z");
// 70% of recognized revenue goes to the publisher, 30% to the platform.
const rule = createShareRule(7000, 3000, 0, 1);

function conversionId(sequence: number): Id<"conversion"> {
  return `cnv_${String(sequence).padStart(26, "0")}` as Id<"conversion">;
}

function conversion(sequence: number, overrides: Partial<BalanceConversion> = {}): BalanceConversion {
  return {
    conversionId: conversionId(sequence),
    currency: "USD",
    state: "approved",
    recognizedMinor: 10_000n,
    shareRule: rule,
    clearedAt: null,
    ...overrides,
  };
}

// In-memory source and store standing in for the ports. Only the port contracts are used here.
class InMemoryBalanceSource implements PublisherBalanceSource {
  readonly rows = new Map<string, BalanceConversion[]>();

  add(publisher: Id<"publisher">, row: BalanceConversion): void {
    this.rows.set(publisher, [...(this.rows.get(publisher) ?? []), row]);
  }

  async listConversions(publisher: Id<"publisher">): Promise<BalanceConversion[]> {
    return this.rows.get(publisher) ?? [];
  }
}

class InMemoryStatementStore implements StatementStore {
  readonly records: StatementRecord[] = [];

  async findClosed(
    publisher: Id<"publisher">,
    currency: string,
    start: Date,
    end: Date,
  ): Promise<StatementRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.publisherId === publisher &&
          record.currency === currency &&
          record.periodStart.getTime() === start.getTime() &&
          record.periodEnd.getTime() === end.getTime(),
      ) ?? null
    );
  }

  async recordClosed(record: StatementRecord): Promise<boolean> {
    if (await this.findClosed(record.publisherId, record.currency, record.periodStart, record.periodEnd)) return false;
    this.records.push(record);
    return true;
  }

  async list(publisher: Id<"publisher">): Promise<StatementRecord[]> {
    return this.records.filter((record) => record.publisherId === publisher);
  }
}

class SequentialIds implements IdGenerator {
  private sequence = 0;

  next<K extends IdKind>(_kind: K): Id<K> {
    this.sequence += 1;
    return `stm_${String(this.sequence).padStart(26, "0")}` as Id<K>;
  }
}

// The clock moves with the test, so a later regeneration sees a later "now" than the period end.
function setup(now: Date = periodEnd) {
  const source = new InMemoryBalanceSource();
  const store = new InMemoryStatementStore();
  let current = now;
  const ctx = {
    db: undefined as never,
    clock: { now: () => current },
    ids: new SequentialIds(),
    actor: { type: "system", id: null },
  } satisfies Ctx;
  return {
    source,
    store,
    ctx,
    setNow(next: Date) {
      current = next;
    },
  };
}

describe("closed statements (DM-050, API-052, TP-W6-030)", () => {
  test("a closed period records a sha256 hash over its canonical content", async () => {
    const { source, store, ctx } = setup();
    source.add(publisherId, conversion(1));

    const result = await closeStatement(
      ctx,
      { source, store },
      { publisherId, currency: "USD", periodStart, periodEnd },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(true);
    expect(result.value.record.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value.record.contentHash).toBe(statementHash(result.value.record.content));
  });

  test("regenerating a closed period returns the same record and hash, even after the source changes (TP-W6-030)", async () => {
    const { source, store, ctx, setNow } = setup();
    source.add(publisherId, conversion(1, { clearedAt: null }));
    const first = await closeStatement(
      ctx,
      { source, store },
      { publisherId, currency: "USD", periodStart, periodEnd },
    );
    if (!first.ok) throw new Error("close failed");

    // After the period closed, the conversion clears and a new one arrives. Neither may reach the closed period.
    setNow(new Date("2026-12-15T00:00:00.000Z"));
    source.add(publisherId, conversion(1, { clearedAt: new Date("2026-11-20T00:00:00.000Z") }));
    source.add(publisherId, conversion(2));
    const again = await closeStatement(
      ctx,
      { source, store },
      { publisherId, currency: "USD", periodStart, periodEnd },
    );

    if (!again.ok) throw new Error("regenerate failed");
    expect(again.value.created).toBe(false);
    expect(again.value.record.id).toBe(first.value.record.id);
    expect(again.value.record.contentHash).toBe(first.value.record.contentHash);
    expect(again.value.record.content).toEqual(first.value.record.content);
    expect(store.records).toHaveLength(1);
    expect(again.value.record.content.totals.approvedMinor).toBe("7000");
  });

  test("the period is valued as of its end, so a conversion cleared later is still approved in that period", async () => {
    const { source, store, ctx } = setup(new Date("2026-12-15T00:00:00.000Z"));
    source.add(publisherId, conversion(1, { clearedAt: new Date("2026-11-20T00:00:00.000Z") }));

    const result = await closeStatement(
      ctx,
      { source, store },
      { publisherId, currency: "USD", periodStart, periodEnd },
    );

    if (!result.ok) throw new Error("close failed");
    expect(result.value.record.content.totals).toEqual({
      estimatedMinor: "0",
      approvedMinor: "7000",
      availableMinor: "0",
    });
  });

  test("content is per currency, in bigint minor units, and other publishers are not included", async () => {
    const { source, store, ctx } = setup();
    source.add(publisherId, conversion(1));
    source.add(publisherId, conversion(2, { currency: "EUR", recognizedMinor: 5_001n }));
    source.add(otherPublisherId, conversion(3, { recognizedMinor: 999_999n }));

    const result = await closeStatement(
      ctx,
      { source, store },
      { publisherId, currency: "USD", periodStart, periodEnd },
    );

    if (!result.ok) throw new Error("close failed");
    expect(result.value.record.content.lines.map((line) => line.conversionId)).toEqual([conversionId(1)]);
    expect(result.value.record.content.totals.approvedMinor).toBe("7000");
  });

  test("the hash changes when content changes and ignores key order", async () => {
    const { source, store, ctx } = setup();
    source.add(publisherId, conversion(1));
    const result = await closeStatement(
      ctx,
      { source, store },
      { publisherId, currency: "USD", periodStart, periodEnd },
    );
    if (!result.ok) throw new Error("close failed");
    const content = result.value.record.content;

    const reordered = Object.fromEntries(Object.entries(content).reverse()) as typeof content;
    const changed = { ...content, totals: { ...content.totals, approvedMinor: "7001" } };

    expect(statementHash(reordered)).toBe(statementHash(content));
    expect(statementHash(changed)).not.toBe(statementHash(content));
  });

  test("a period that ends before it starts is refused", async () => {
    const { source, store, ctx } = setup();

    const result = await closeStatement(
      ctx,
      { source, store },
      {
        publisherId,
        currency: "USD",
        periodStart: periodEnd,
        periodEnd: periodStart,
      },
    );

    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.records).toHaveLength(0);
  });

  test("listStatements filters by year, month, and currency within one publisher (API-052)", async () => {
    const { source, store, ctx } = setup();
    source.add(publisherId, conversion(1));
    source.add(publisherId, conversion(2, { currency: "EUR" }));
    const october = await closeStatement(
      ctx,
      { source, store },
      { publisherId, currency: "USD", periodStart, periodEnd },
    );
    const eur = await closeStatement(ctx, { source, store }, { publisherId, currency: "EUR", periodStart, periodEnd });
    if (!october.ok || !eur.ok) throw new Error("close failed");
    await closeStatement(
      ctx,
      { source, store },
      {
        publisherId: otherPublisherId,
        currency: "USD",
        periodStart,
        periodEnd,
      },
    );

    const all = await listStatements({ store }, { publisherId });
    const usdOctober = await listStatements({ store }, { publisherId, year: 2026, month: 10, currency: "USD" });
    const november = await listStatements({ store }, { publisherId, year: 2026, month: 11 });

    expect(all.ok && all.value.map((record) => record.id).sort()).toEqual(
      [october.value.record.id, eur.value.record.id].sort(),
    );
    expect(usdOctober.ok && usdOctober.value.map((record) => record.id)).toEqual([october.value.record.id]);
    expect(november.ok && november.value).toEqual([]);
  });

  test("listStatements refuses a month outside 1 to 12", async () => {
    const { store } = setup();

    const result = await listStatements({ store }, { publisherId, month: 13 });

    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
  });
});
