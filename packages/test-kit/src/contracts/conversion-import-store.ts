import { beforeEach, describe, expect, test } from "bun:test";
import { type ImportBatchInput, importConversionBatch } from "@moneytrap/app/src/conversions/import-batch";
import type { ConversionImportStore } from "@moneytrap/app/src/ports/conversion-import-store";
import { FakeClock } from "../clock";
import { FakeIdGenerator } from "../fakes/id-generator";
import { fixtureCtx } from "../fixtures/ctx";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

function row(ref: string, overrides: Record<string, unknown> = {}) {
  return {
    externalRowRef: ref,
    sourceRevision: "r1",
    amount: "12.34",
    currency: "USD",
    status: "approved",
    occurredAt: "2026-10-01T12:00:00.000Z",
    subId: "sub-1",
    ...overrides,
  };
}

function batch(sha256Digest: string, rows: unknown[]): ImportBatchInput {
  return {
    networkId: "net_one",
    resource: "transactions",
    sha256Digest,
    objectRef: `objects/${sha256Digest.slice(0, 4)}.json`,
    parserVersion: "v1",
    sourceFrom: null,
    sourceTo: null,
    rows,
  };
}

/** Thrown by the wrapper below, so an interrupted import can be told apart from a real failure. */
class Interrupted extends Error {}

// Wraps a store so applyRow throws after `calls` successful rows, which is how an import is interrupted mid-file.
function interruptAfter(store: ConversionImportStore, calls: number): ConversionImportStore {
  let applied = 0;
  return {
    openBatch: (input) => store.openBatch(input),
    recordQuarantine: (input) => store.recordQuarantine(input),
    completeBatch: (input) => store.completeBatch(input),
    async applyRow(input) {
      if (applied >= calls) throw new Interrupted("import interrupted");
      applied += 1;
      return store.applyRow(input);
    },
  };
}

/** Runs one behavior suite against each adapter, so the fake and the database adapter share one contract (WP-6.5). */
export function runConversionImportContract(
  adapters: ReadonlyArray<{
    name: string;
    open(): Promise<{ store: ConversionImportStore; close(): Promise<void> }>;
  }>,
): void {
  describe.each(adapters)("TP-W6-014 to TP-W6-020 $name conversion import contract", ({ open }) => {
    async function withStore(check: (store: ConversionImportStore) => Promise<void>): Promise<void> {
      const fixture = await open();
      try {
        await check(fixture.store);
      } finally {
        await fixture.close();
      }
    }

    // One ID generator per test: every batch and row in a test needs its own ID, as the database enforces.
    let ids: FakeIdGenerator;
    beforeEach(() => {
      ids = new FakeIdGenerator();
    });
    const ctxFor = () =>
      fixtureCtx<Record<string, never>>(undefined as never, {
        clock: new FakeClock(new Date("2026-10-31T10:00:00.000Z")),
        ids,
      });

    test("TP-W6-014 importing a batch once creates every row at revision 1", async () => {
      await withStore(async (store) => {
        const result = await importConversionBatch(ctxFor(), store, batch(digestA, [row("tx-1"), row("tx-2")]));

        expect(result).toMatchObject({ ok: true, value: { outcome: "imported", counts: { created: 2 } } });
      });
    });

    test("TP-W6-015 CT-012 replaying an identical batch is a no-op", async () => {
      await withStore(async (store) => {
        await importConversionBatch(ctxFor(), store, batch(digestA, [row("tx-1")]));

        const replay = await importConversionBatch(ctxFor(), store, batch(digestA, [row("tx-1")]));

        expect(replay).toMatchObject({
          ok: true,
          value: { outcome: "replayed", counts: { created: 0, revised: 0, unchanged: 0, quarantined: 0 } },
        });
      });
    });

    test("TP-W6-016 CT-018 a changed row creates a revision and the other rows stay unchanged", async () => {
      await withStore(async (store) => {
        await importConversionBatch(ctxFor(), store, batch(digestA, [row("tx-1"), row("tx-2")]));

        const result = await importConversionBatch(
          ctxFor(),
          store,
          batch(digestB, [row("tx-1", { amount: "10.00" }), row("tx-2")]),
        );

        expect(result).toMatchObject({
          ok: true,
          value: { outcome: "imported", counts: { revised: 1, unchanged: 1 } },
        });
      });
    });

    test("a label-only change with the same content creates no revision", async () => {
      await withStore(async (store) => {
        await importConversionBatch(ctxFor(), store, batch(digestA, [row("tx-1")]));

        const result = await importConversionBatch(
          ctxFor(),
          store,
          batch(digestB, [row("tx-1", { sourceRevision: "r2" })]),
        );

        expect(result).toMatchObject({ ok: true, value: { counts: { revised: 0, unchanged: 1 } } });
      });
    });

    test("TP-W6-020 a malformed row is quarantined and the other rows import", async () => {
      await withStore(async (store) => {
        const result = await importConversionBatch(
          ctxFor(),
          store,
          batch(digestA, [row("tx-1"), row("tx-2", { amount: "12.345" }), row("tx-3")]),
        );

        expect(result).toMatchObject({ ok: true, value: { counts: { created: 2, quarantined: 1 } } });
      });
    });

    test("TP-W6-019 an interrupted import resumed with the same file completes with no duplicates", async () => {
      await withStore(async (store) => {
        const rows = [row("tx-1"), row("tx-2"), row("tx-3")];
        await expect(importConversionBatch(ctxFor(), interruptAfter(store, 1), batch(digestA, rows))).rejects.toThrow(
          Interrupted,
        );

        const resumed = await importConversionBatch(ctxFor(), store, batch(digestA, rows));
        expect(resumed).toMatchObject({ ok: true, value: { outcome: "imported", counts: { created: 3 } } });

        const replay = await importConversionBatch(ctxFor(), store, batch(digestA, rows));
        expect(replay).toMatchObject({ ok: true, value: { outcome: "replayed" } });
      });
    });

    test("a file that reports one reference twice is rejected whole", async () => {
      await withStore(async (store) => {
        const result = await importConversionBatch(ctxFor(), store, batch(digestA, [row("tx-1"), row("tx-1")]));

        expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
      });
    });

    test("a digest that is not lower-case SHA-256 hex is rejected before anything is written", async () => {
      await withStore(async (store) => {
        const result = await importConversionBatch(ctxFor(), store, batch("ABC", [row("tx-1")]));

        expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
      });
    });
  });
}
