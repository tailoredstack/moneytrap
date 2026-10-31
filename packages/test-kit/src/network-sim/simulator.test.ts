import { describe, expect, test } from "bun:test";
import type { ProgramRecord } from "@moneytrap/app/src/ports/network-connector";
import { fixtureId } from "../fixtures/ids";
import { type FixtureName, RECORDED_FIXTURES } from "./fixtures";
import { RecordedNetworkSimulator } from "./simulator";

const range = { from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-11-01T00:00:00.000Z") };

describe("RecordedNetworkSimulator (WP-4.2)", () => {
  test("TP-W4-001 validate connection returns the fixture capability profile for a valid credential", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");

    const result = await simulator.validateConnection();

    expect(result.ok && result.value.capabilities).toEqual(RECORDED_FIXTURES["clean-catalog"].capabilities);
  });

  test("TP-W4-002 a disabled credential fails every operation as not_authorized (CT-009)", async () => {
    const simulator = new RecordedNetworkSimulator("disabled-credential");

    expect(await simulator.validateConnection()).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(await simulator.discoverAdvertisers({ cursor: null })).toEqual({
      ok: false,
      failure: { state: "not_authorized" },
    });
    expect(await simulator.listTransactions({ ...range, cursor: null })).toEqual({
      ok: false,
      failure: { state: "not_authorized" },
    });
  });

  test("TP-W4-003 an unsupported operation fails as unsupported, never as an empty page", async () => {
    const simulator = new RecordedNetworkSimulator({
      ...RECORDED_FIXTURES["clean-catalog"],
      capabilities: { ...RECORDED_FIXTURES["clean-catalog"].capabilities, list_adjustments: "unsupported" },
    });

    expect(await simulator.listAdjustments({ ...range, cursor: null })).toEqual({
      ok: false,
      failure: { state: "unsupported" },
    });
  });

  test("TP-W4-005 pages are consumed in order and the watermark is reported on every page", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");

    const first = await simulator.listTransactions({ ...range, cursor: null });
    const cursor = first.ok ? first.value.nextCursor : null;
    const second = await simulator.listTransactions({ ...range, cursor });

    expect(first.ok && first.value.items.map((item) => item.sourceId)).toEqual(["txn-1", "txn-2"]);
    expect(first.ok && first.value.nextCursor).not.toBeNull();
    expect(second.ok && second.value.items.map((item) => item.sourceId)).toEqual(["txn-3"]);
    expect(second.ok && second.value.nextCursor).toBeNull();
    expect(second.ok && second.value.watermark).toEqual(RECORDED_FIXTURES["clean-catalog"].watermark);
  });

  test("transactions and adjustments outside the requested time range are not returned", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");
    const beforeAnyRecord = { from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-10-02T00:00:00.000Z") };

    const transactions = await simulator.listTransactions({ ...beforeAnyRecord, cursor: null });
    const adjustments = await simulator.listAdjustments({ ...beforeAnyRecord, cursor: null });

    expect(transactions.ok && transactions.value.items.map((item) => item.sourceId)).toEqual([]);
    expect(adjustments.ok && adjustments.value.items).toEqual([]);
  });

  test("TP-W4-008 the same request returns identical results every time", async () => {
    const first = new RecordedNetworkSimulator("clean-catalog");
    const second = new RecordedNetworkSimulator("clean-catalog");

    const input = { ...range, cursor: null };
    expect(await first.listTransactions(input)).toEqual(await second.listTransactions(input));
    expect(await first.listTransactions(input)).toEqual(await first.listTransactions(input));
  });

  test("adjustments link to the transaction they change", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");

    const result = await simulator.listAdjustments({ ...range, cursor: null });

    expect(result.ok && result.value.items).toEqual([
      expect.objectContaining({ sourceId: "adj-1", originalTransactionId: "txn-1" }),
    ]);
  });

  test("settlement evidence is returned for the period", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");

    const result = await simulator.retrieveSettlementEvidence({ ...range, cursor: null });

    expect(result.ok && result.value.items.map((item) => item.remittanceId)).toEqual(["rem-1"]);
  });

  test("TP-W4-009 a changed commission arrives as a new revision with the same source identity", async () => {
    const programs = await programsOf("commission-change");
    const prg1 = programs.filter((program) => program.sourceId === "prg-1");

    expect(prg1).toEqual([expect.objectContaining({ revision: "2", terms: "Commission 10% on net sales" })]);
  });

  test("TP-W4-010 a program record missing its source ID is passed through for quarantine, not repaired", async () => {
    const programs = await programsOf("malformed-records");

    expect(programs.some((program) => program.sourceId === undefined)).toBe(true);
  });

  test("TP-W4-011 an unknown payload field is passed through unchanged for the sync to count", async () => {
    const programs = await programsOf("malformed-records");

    expect(programs.find((program) => program.sourceId === "prg-4")).toEqual(
      expect.objectContaining({ campaignTier: "gold" }),
    );
  });

  test("TP-W4-013 an interrupted sync resumes from the cursor it stopped at, without duplicates", async () => {
    const simulator = new RecordedNetworkSimulator("sync-interrupt");
    const input = { advertiserSourceId: "adv-200" };

    const firstPage = await simulator.discoverPrograms({ ...input, cursor: null });
    expect(firstPage.ok).toBe(true);
    const resumePoint = firstPage.ok ? firstPage.value.nextCursor : null;
    expect(resumePoint).not.toBeNull();

    const failed = await simulator.discoverPrograms({ ...input, cursor: resumePoint });
    expect(failed).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: 30 } });

    const resumed = await simulator.discoverPrograms({ ...input, cursor: resumePoint });
    expect(resumed.ok && resumed.value.items.map((item) => item.sourceId)).toEqual(["prg-3"]);
    expect(simulator.requests.map((request) => request.cursor)).toEqual([null, resumePoint, resumePoint]);
  });

  test("tracking links are created only for a program the network reports as approved", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");
    const request = {
      propertyId: fixtureId("property"),
      destinationUrl: "https://example.test/item",
      subId: "click-1",
    };

    const approved = await simulator.resolveTrackingDestination({ ...request, programSourceId: "prg-1" });
    const pending = await simulator.resolveTrackingDestination({ ...request, programSourceId: "prg-2" });

    expect(approved.ok && approved.value.subId).toBe("click-1");
    expect(pending).toEqual({ ok: false, failure: { state: "not_authorized" } });
  });

  test("a callback with a valid signature is verified; a forged one is refused", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");

    const valid = await simulator.receiveNotification({ headers: { "x-sim-signature": "sig-valid" }, body: "{}" });
    const forged = await simulator.receiveNotification({ headers: { "x-sim-signature": "nope" }, body: "{}" });

    expect(valid.ok && valid.value.eventId).toBe("evt-1");
    expect(forged).toEqual({ ok: false, failure: { state: "not_authorized" } });
  });

  test("a cursor this simulator did not issue is a caller bug and throws", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");

    await expect(simulator.listTransactions({ ...range, cursor: "next-page" })).rejects.toThrow(RangeError);
  });

  test("a fabricated numeric cursor is refused instead of skipping records", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");

    await expect(simulator.listTransactions({ ...range, cursor: "1" })).rejects.toThrow(RangeError);
    await expect(simulator.listTransactions({ ...range, cursor: "99999999999999999999999" })).rejects.toThrow(
      RangeError,
    );
  });

  test("a cursor issued for one operation or query is refused by another", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");
    const first = await simulator.listTransactions({ ...range, cursor: null });
    const cursor = first.ok ? first.value.nextCursor : null;

    await expect(simulator.listAdjustments({ ...range, cursor })).rejects.toThrow(RangeError);
    await expect(
      simulator.listTransactions({ from: range.from, to: new Date("2026-10-15T00:00:00.000Z"), cursor }),
    ).rejects.toThrow(RangeError);
    await expect(simulator.discoverPrograms({ advertiserSourceId: "adv-100", cursor })).rejects.toThrow(RangeError);
  });

  test("mutating a returned response does not change later answers from the same or a new simulator", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");
    const input = { ...range, cursor: null };

    const first = await simulator.listTransactions(input);
    if (!first.ok) throw new Error("expected a page");
    first.value.watermark.setTime(0);
    first.value.items[0] = { ...first.value.items[0], sourceId: "tampered" } as (typeof first.value.items)[0];

    const repeat = await simulator.listTransactions(input);
    const fresh = await new RecordedNetworkSimulator("clean-catalog").listTransactions(input);
    expect(repeat).toEqual(fresh);
    expect(repeat.ok && repeat.value.items[0]?.sourceId).toBe("txn-1");
    expect(repeat.ok && repeat.value.watermark).toEqual(RECORDED_FIXTURES["clean-catalog"].watermark);
  });

  test("mutating a returned capability profile does not change later validation answers", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");

    const first = await simulator.validateConnection();
    if (!first.ok) throw new Error("expected a profile");
    (first.value.capabilities as Record<string, string>).list_adjustments = "unsupported";

    const second = await simulator.validateConnection();
    expect(second.ok && second.value.capabilities.list_adjustments).toBe("supported");
  });

  test("an unknown fixture name is rejected", () => {
    expect(() => new RecordedNetworkSimulator("made-up" as "clean-catalog")).toThrow(RangeError);
  });
});

async function programsOf(name: FixtureName): Promise<Partial<ProgramRecord>[]> {
  const simulator = new RecordedNetworkSimulator(name);
  const programs: Partial<ProgramRecord>[] = [];
  for (const advertiserSourceId of ["adv-100", "adv-200"]) {
    let cursor: string | null = null;
    do {
      const page = await simulator.discoverPrograms({ advertiserSourceId, cursor });
      if (!page.ok) throw new Error(`unexpected failure ${JSON.stringify(page.failure)}`);
      programs.push(...page.value.items);
      cursor = page.value.nextCursor;
    } while (cursor !== null);
  }
  return programs;
}
