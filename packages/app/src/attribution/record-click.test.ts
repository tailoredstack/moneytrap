import { describe, expect, test } from "bun:test";
import type { ClickObservation, ClickRecordOutcome, ClickStore } from "../ports/click-store";
import { recordClick } from "./record-click";

// Models the adapter contract: one fact per dedup key, and a duplicate writes nothing.
class MemoryClickStore implements ClickStore {
  facts = new Map<string, ClickObservation>();

  async record(click: ClickObservation): Promise<ClickRecordOutcome> {
    if (this.facts.has(click.dedupKey)) return "duplicate";
    this.facts.set(click.dedupKey, click);
    return "recorded";
  }
}

const occurredAt = new Date("2026-03-01T10:00:00.000Z");
const click = (dedupKey: string, overrides: Partial<ClickObservation> = {}): ClickObservation => ({
  dedupKey,
  linkId: "lnk_01arz3ndektsv4rrffq69g5fav",
  occurredAt,
  ...overrides,
});

describe("record click (TP-W5-032, TP-W5-033, WP-5.8; 034 and 035 are in the Postgres suite)", () => {
  test("one click leaves one fact (TP-W5-032)", async () => {
    const store = new MemoryClickStore();
    expect(await recordClick(store, click("click:a"))).toBe("recorded");
    expect(store.facts.size).toBe(1);
  });

  test("the same click emitted twice leaves one fact (TP-W5-033, CT-013)", async () => {
    const store = new MemoryClickStore();
    expect(await recordClick(store, click("click:a"))).toBe("recorded");
    expect(await recordClick(store, click("click:a"))).toBe("duplicate");
    expect(store.facts.size).toBe(1);
  });

  test("a blank or overlong dedup key is rejected before the store is called", async () => {
    const store = new MemoryClickStore();
    await expect(recordClick(store, click("  "))).rejects.toThrow("dedupKey is required");
    await expect(recordClick(store, click("x".repeat(201)))).rejects.toThrow("dedupKey is too long");
    expect(store.facts.size).toBe(0);
  });

  test("a click without a link or a valid time is rejected", async () => {
    const store = new MemoryClickStore();
    await expect(recordClick(store, click("click:a", { linkId: "" }))).rejects.toThrow("linkId is required");
    await expect(recordClick(store, click("click:a", { occurredAt: new Date("nope") }))).rejects.toThrow(
      "occurredAt must be a valid date",
    );
    expect(store.facts.size).toBe(0);
  });
});
