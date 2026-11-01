import { describe, expect, test } from "bun:test";
import type { StatementRecord, StatementStore } from "@moneytrap/app/src/ports/statement-store";

export type StatementStoreFixture = {
  store: StatementStore;
  seed(record: StatementRecord): Promise<void>;
  close(): Promise<void>;
};

export function runStatementStoreContract(
  adapters: ReadonlyArray<{ name: string; open(): Promise<StatementStoreFixture> }>,
): void {
  describe.each(adapters)("TP-W6-048 $name statement store contract", ({ open }) => {
    test("persists and reloads statements, refuses replacement, and isolates publishers", async () => {
      const fixture = await open();
      try {
        const first = record("stm_a", "pub_a", "first");
        const changed = record("stm_b", "pub_a", "changed");
        await fixture.seed(first);
        expect(
          await fixture.store.findClosed(first.publisherId, first.currency, first.periodStart, first.periodEnd),
        ).toEqual(first);
        expect(await fixture.store.recordClosed(changed)).toBe(false);
        expect(
          await fixture.store.findClosed(first.publisherId, first.currency, first.periodStart, first.periodEnd),
        ).toEqual(first);
        expect(await fixture.store.list(first.publisherId)).toEqual([first]);
        expect(await fixture.store.list("pub_b" as typeof first.publisherId)).toEqual([]);
      } finally {
        await fixture.close();
      }
    });
  });
}

function record(id: string, publisherId: string, amount: string): StatementRecord {
  const periodStart = new Date("2026-10-01T00:00:00.000Z");
  const periodEnd = new Date("2026-11-01T00:00:00.000Z");
  const content = {
    publisherId: publisherId as StatementRecord["publisherId"],
    currency: "USD" as const,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    asOf: periodEnd.toISOString(),
    totals: { estimatedMinor: amount, approvedMinor: amount, availableMinor: amount },
    lines: [],
  };
  return {
    id: id as StatementRecord["id"],
    publisherId: publisherId as StatementRecord["publisherId"],
    currency: "USD",
    periodStart,
    periodEnd,
    revision: 1,
    contentHash: "a".repeat(64),
    objectRef: `statements/${id}.json`,
    content,
    createdAt: periodEnd,
  };
}
