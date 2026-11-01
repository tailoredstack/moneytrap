import { describe, expect, test } from "bun:test";
import type { Ctx } from "../ctx";
import type { ReceiptRecord, RecordReceiptOutcome, SettlementReceiptStore } from "../ports/settlement-receipt-store";
import { importReceipts, parseReceiptFile, uploadReceiptFile } from "./receipts";

// The app package has no test-kit dependency, so the store and the context are local. The fake store in test-kit runs the same
// behavior through the shared port.
class MemoryReceiptStore implements SettlementReceiptStore {
  readonly receipts: ReceiptRecord[] = [];

  async record(receipt: ReceiptRecord): Promise<RecordReceiptOutcome> {
    const existing = this.receipts.find(
      (stored) => stored.networkId === receipt.networkId && stored.externalRef === receipt.externalRef,
    );
    if (existing) return { kind: "existing", existing };
    this.receipts.push(receipt);
    return { kind: "created" };
  }
}

class SequentialIds {
  private sequence = 0;
  next(kind: string) {
    this.sequence += 1;
    return `${kind}_${String(this.sequence).padStart(26, "0")}`;
  }
}

const header = "external_ref,gross_minor,currency,received_at,state";
const line = (ref: string, gross = "5000", currency = "USD") =>
  `${ref},${gross},${currency},2026-10-31T09:00:00.000Z,cleared`;

function ctxFor(): Ctx {
  return {
    db: undefined as never,
    clock: { now: () => new Date("2026-11-01T08:00:00.000Z") },
    ids: new SequentialIds() as unknown as Ctx["ids"],
    actor: { type: "system", id: null },
  };
}

describe("parseReceiptFile (TP-W7-002)", () => {
  test("parses every row with bigint minor units and a parsed received date", () => {
    const result = parseReceiptFile([header, line("rcpt-1"), line("rcpt-2", "12345")].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[1]).toMatchObject({
      externalRef: "rcpt-2",
      grossMinor: 12345n,
      currency: "USD",
      state: "cleared",
    });
    expect(result.value[0]?.receivedAt).toEqual(new Date("2026-10-31T09:00:00.000Z"));
  });

  test("accepts the columns in any order and ignores extra columns", () => {
    const reordered =
      "state,extra,gross_minor,external_ref,currency,received_at\ncleared,x,700,rcpt-1,EUR,2026-10-31T09:00:00.000Z";

    const result = parseReceiptFile(reordered);

    expect(result).toMatchObject({ ok: true, value: [{ externalRef: "rcpt-1", grossMinor: 700n, currency: "EUR" }] });
  });

  test("rejects a file missing a required column", () => {
    const result = parseReceiptFile(
      "external_ref,gross_minor,currency,received_at\nrcpt-1,700,USD,2026-10-31T09:00:00.000Z",
    );

    expect(result).toMatchObject({ ok: false, errors: [{ line: 1, reason: expect.stringContaining("state") }] });
  });

  test("reports every invalid row with its line number", () => {
    const text = [
      header,
      line("rcpt-1"),
      line("rcpt-2", "12.50"),
      line("rcpt-3", "5000", "usd"),
      "rcpt-4,5000,USD,not-a-date,cleared",
      "rcpt-5,5000,USD",
    ].join("\n");

    const result = parseReceiptFile(text);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.line)).toEqual([3, 4, 5, 6]);
  });

  test("rejects a negative or non-integer gross", () => {
    const result = parseReceiptFile([header, line("rcpt-1", "-1"), line("rcpt-2", "1e3")].join("\n"));

    expect(result).toMatchObject({ ok: false, errors: [{ line: 2 }, { line: 3 }] });
  });

  test("rejects a file that reuses an external reference", () => {
    const result = parseReceiptFile([header, line("rcpt-1"), line("rcpt-1", "900")].join("\n"));

    expect(result).toMatchObject({ ok: false, errors: [{ line: 3, reason: expect.stringContaining("rcpt-1") }] });
  });

  test("rejects an empty file with no receipt rows", () => {
    expect(parseReceiptFile(header)).toMatchObject({ ok: false });
  });
});

describe("importReceipts (TP-W7-001)", () => {
  test("stores a receipt once under its source identity", async () => {
    const store = new MemoryReceiptStore();
    const parsed = parseReceiptFile([header, line("rcpt-1")].join("\n"));
    if (!parsed.ok) throw new Error("fixture must parse");

    const first = await importReceipts(ctxFor(), store, {
      networkId: "net_one",
      objectRef: "upload:1",
      rows: parsed.value,
    });
    const replay = await importReceipts(ctxFor(), store, {
      networkId: "net_one",
      objectRef: "upload:2",
      rows: parsed.value,
    });

    expect(first).toMatchObject({ ok: true, value: { counts: { created: 1, duplicate: 0, conflict: 0 } } });
    expect(replay).toMatchObject({ ok: true, value: { counts: { created: 0, duplicate: 1, conflict: 0 } } });
    expect(store.receipts).toHaveLength(1);
    expect(store.receipts[0]).toMatchObject({ networkId: "net_one", externalRef: "rcpt-1", grossMinor: 5000n });
  });

  test("keeps the first stored receipt and reports a conflict when a repeated reference changes amount", async () => {
    const store = new MemoryReceiptStore();
    const ctx = ctxFor();
    const original = parseReceiptFile([header, line("rcpt-1", "5000")].join("\n"));
    const changed = parseReceiptFile([header, line("rcpt-1", "4000")].join("\n"));
    if (!original.ok || !changed.ok) throw new Error("fixture must parse");

    await importReceipts(ctx, store, { networkId: "net_one", objectRef: "upload:1", rows: original.value });
    const result = await importReceipts(ctx, store, {
      networkId: "net_one",
      objectRef: "upload:2",
      rows: changed.value,
    });

    expect(result).toMatchObject({ ok: true, value: { counts: { created: 0, duplicate: 0, conflict: 1 } } });
    expect(store.receipts).toHaveLength(1);
    expect(store.receipts[0]?.grossMinor).toBe(5000n);
  });

  test("treats the same reference from another network as a different receipt", async () => {
    const store = new MemoryReceiptStore();
    const parsed = parseReceiptFile([header, line("rcpt-1")].join("\n"));
    if (!parsed.ok) throw new Error("fixture must parse");

    await importReceipts(ctxFor(), store, { networkId: "net_one", objectRef: "upload:1", rows: parsed.value });
    const other = await importReceipts(ctxFor(), store, {
      networkId: "net_two",
      objectRef: "upload:2",
      rows: parsed.value,
    });

    expect(other).toMatchObject({ ok: true, value: { counts: { created: 1 } } });
    expect(store.receipts).toHaveLength(2);
  });
});

describe("uploadReceiptFile (TP-W7-002)", () => {
  test("imports a valid upload and returns the counts", async () => {
    const store = new MemoryReceiptStore();

    const result = await uploadReceiptFile(ctxFor(), store, {
      networkId: "net_one",
      objectRef: "upload:1",
      text: [header, line("rcpt-1"), line("rcpt-2")].join("\n"),
    });

    expect(result).toMatchObject({ ok: true, value: { counts: { created: 2, duplicate: 0, conflict: 0 } } });
    expect(store.receipts).toHaveLength(2);
  });

  test("writes nothing when any row is invalid", async () => {
    const store = new MemoryReceiptStore();

    const result = await uploadReceiptFile(ctxFor(), store, {
      networkId: "net_one",
      objectRef: "upload:1",
      text: [header, line("rcpt-1"), line("rcpt-2", "oops")].join("\n"),
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED", errors: [{ line: 3 }] });
    expect(store.receipts).toHaveLength(0);
  });

  test("rejects an upload without a network or object reference", async () => {
    const store = new MemoryReceiptStore();
    const text = [header, line("rcpt-1")].join("\n");

    expect(await uploadReceiptFile(ctxFor(), store, { networkId: " ", objectRef: "upload:1", text })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await uploadReceiptFile(ctxFor(), store, { networkId: "net_one", objectRef: "", text })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(store.receipts).toHaveLength(0);
  });
});
