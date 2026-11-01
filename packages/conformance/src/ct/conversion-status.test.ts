import { describe, expect, test } from "bun:test";
import { recordConversionAdjustment, recordConversionStatus } from "@moneytrap/app/src/conversions/status";
import type { ConversionState, Id } from "@moneytrap/domain";
import { FakeClock, FakeIdGenerator, fixtureCtx, fixtureId } from "@moneytrap/test-kit";
import { FakeConversionStatusStore } from "@moneytrap/test-kit/src/fakes/conversion-status-store";

const conversionId = fixtureId("conversion", 1) as Id<"conversion">;
const sourceAt = new Date("2026-10-01T10:00:00Z");

function setup(state: ConversionState | null = null) {
  const store = new FakeConversionStatusStore();
  store.addConversion(conversionId, "USD", state);
  const ctx = fixtureCtx<Record<string, never>>(undefined as never, {
    clock: new FakeClock(),
    ids: new FakeIdGenerator(),
  });
  return { store, ctx };
}

const status = (
  ctx: ReturnType<typeof setup>["ctx"],
  store: FakeConversionStatusStore,
  sourceEventKey: string,
  toState: ConversionState,
) => recordConversionStatus(ctx, store, { conversionId, sourceEventKey, toState, sourceAt });

describe("recordConversionStatus", () => {
  test("TP-W6-018 each transition is recorded as an event with its from and to state", async () => {
    const { store, ctx } = setup();

    expect(await status(ctx, store, "evt-1", "pending")).toMatchObject({
      ok: true,
      value: { outcome: "recorded", state: "pending" },
    });
    expect(await status(ctx, store, "evt-2", "approved")).toMatchObject({
      ok: true,
      value: { outcome: "recorded", state: "approved" },
    });

    expect(store.events.map((e) => [e.fromState, e.toState, e.sourceEventKey])).toEqual([
      [null, "pending", "evt-1"],
      ["pending", "approved", "evt-2"],
    ]);
  });

  test("TP-W6-018 an illegal transition is rejected and writes no event", async () => {
    const { store, ctx } = setup("approved");

    const result = await status(ctx, store, "evt-3", "declined");

    expect(result).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    expect(store.events).toHaveLength(0);
  });

  test("TP-W6-018 a replayed source event writes nothing, even after the state has moved on", async () => {
    const { store, ctx } = setup();
    await status(ctx, store, "evt-1", "pending");
    await status(ctx, store, "evt-2", "approved");

    const replay = await status(ctx, store, "evt-1", "pending");

    expect(replay).toMatchObject({ ok: true, value: { outcome: "duplicate", state: "approved" } });
    expect(store.events).toHaveLength(2);
  });

  test("a report that repeats the current state writes no event", async () => {
    const { store, ctx } = setup("approved");

    expect(await status(ctx, store, "evt-9", "approved")).toMatchObject({
      ok: true,
      value: { outcome: "unchanged", state: "approved" },
    });
    expect(store.events).toHaveLength(0);
  });

  test("an unknown conversion is not found", async () => {
    const { store, ctx } = setup();

    const result = await recordConversionStatus(ctx, store, {
      conversionId: fixtureId("conversion", 99) as Id<"conversion">,
      sourceEventKey: "evt-1",
      toState: "pending",
      sourceAt,
    });

    expect(result).toMatchObject({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("a stale append is refused by the store when another event landed first", async () => {
    const { store } = setup("pending");

    const outcome = await store.appendStatusEvent({
      id: fixtureId("conversionStatusEvent", 1) as Id<"conversionStatusEvent">,
      conversionId,
      sourceEventKey: "evt-late",
      fromState: null,
      toState: "pending",
      sourceAt,
      receivedAt: sourceAt,
    });

    expect(outcome).toBe("stale");
    expect(store.events).toHaveLength(0);
  });
});

describe("recordConversionAdjustment", () => {
  const adjustment = (
    ctx: ReturnType<typeof setup>["ctx"],
    store: FakeConversionStatusStore,
    externalAdjustmentId: string,
    deltaMinor: bigint,
  ) =>
    recordConversionAdjustment(ctx, store, {
      conversionId,
      externalAdjustmentId,
      deltaMinor,
      currency: "USD",
      reason: "clawback",
      reportedAt: sourceAt,
    });

  test("TP-W6-017 an adjustment is a new row and the status history is untouched", async () => {
    const { store, ctx } = setup();
    await status(ctx, store, "evt-1", "pending");
    await status(ctx, store, "evt-2", "approved");
    const eventsBefore = structuredClone(store.events);

    const result = await adjustment(ctx, store, "adj-1", -250n);

    expect(result).toMatchObject({ ok: true, value: { outcome: "recorded" } });
    expect(store.adjustments.map((a) => [a.externalAdjustmentId, a.deltaMinor])).toEqual([["adj-1", -250n]]);
    expect(store.events).toEqual(eventsBefore);
  });

  test("TP-W6-017 a second adjustment is appended beside the first, never replacing it", async () => {
    const { store, ctx } = setup("approved");

    await adjustment(ctx, store, "adj-1", -250n);
    await adjustment(ctx, store, "adj-2", -100n);

    expect(store.adjustments.map((a) => a.externalAdjustmentId)).toEqual(["adj-1", "adj-2"]);
  });

  test("TP-W6-017 the same adjustment reported again writes nothing", async () => {
    const { store, ctx } = setup("approved");
    await adjustment(ctx, store, "adj-1", -250n);

    expect(await adjustment(ctx, store, "adj-1", -250n)).toMatchObject({
      ok: true,
      value: { outcome: "duplicate" },
    });
    expect(store.adjustments).toHaveLength(1);
  });

  test("TP-W6-017 the same adjustment ID with different content is a conflict, not an update", async () => {
    const { store, ctx } = setup("approved");
    await adjustment(ctx, store, "adj-1", -250n);

    expect(await adjustment(ctx, store, "adj-1", -300n)).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    expect(store.adjustments).toHaveLength(1);
    expect(store.adjustments[0]?.deltaMinor).toBe(-250n);
  });

  test("an adjustment in another currency is rejected", async () => {
    const { store, ctx } = setup("approved");

    const result = await recordConversionAdjustment(ctx, store, {
      conversionId,
      externalAdjustmentId: "adj-eur",
      deltaMinor: -250n,
      currency: "EUR",
      reason: null,
      reportedAt: sourceAt,
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.adjustments).toHaveLength(0);
  });
});
