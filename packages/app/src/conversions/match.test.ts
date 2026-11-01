import { describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import type { AttributableClick, AttributionClickStore } from "../ports/attribution-click-store";
import { ATTRIBUTION_WINDOW_MS, type AttributionInput, matchConversion } from "./match";

const conversionId = "cnv_01arz3ndektsv4rrffq69g5fav" as Id<"conversion">;
const occurredAt = new Date("2026-03-20T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

// Models the adapter contract: a lookup returns every click that carries the sub ID, and nothing else.
class MemoryClickStore implements AttributionClickStore {
  calls: string[] = [];
  constructor(private readonly clicks: Map<string, AttributableClick[]> = new Map()) {}

  async clicksWithSubId(subId: string): Promise<AttributableClick[]> {
    this.calls.push(subId);
    return this.clicks.get(subId) ?? [];
  }
}

const click = (dedupKey: string, overrides: Partial<AttributableClick> = {}): AttributableClick => ({
  dedupKey,
  linkId: "lnk_01arz3ndektsv4rrffq69g5fav",
  publisherId: "pub_01arz3ndektsv4rrffq69g5fav",
  occurredAt: new Date(occurredAt.getTime() - 60_000),
  ...overrides,
});

const input = (overrides: Partial<AttributionInput> = {}): AttributionInput => ({
  conversionId,
  subId: "sub-1",
  occurredAt,
  ...overrides,
});

describe("attribution matching (TP-W6-021 to TP-W6-024, DM-036, CT-020; WP-6.7)", () => {
  test("a conversion with a click inside the window is attributed to the click's link and publisher (TP-W6-021)", async () => {
    const store = new MemoryClickStore(new Map([["sub-1", [click("click:a")]]]));
    const result = await matchConversion(store, input());
    expect(result).toEqual({
      kind: "attributed",
      linkId: "lnk_01arz3ndektsv4rrffq69g5fav",
      publisherId: "pub_01arz3ndektsv4rrffq69g5fav",
      clickDedupKey: "click:a",
      rule: "last_click_in_window",
    });
  });

  test("a conversion with no click goes to the exception queue and is not assigned to any publisher (TP-W6-022, CT-020)", async () => {
    const store = new MemoryClickStore();
    const result = await matchConversion(store, input());
    expect(result).toEqual({ kind: "exception", conversionId, reason: "no_click" });
    expect(JSON.stringify(result)).not.toContain("publisherId");
  });

  test("a conversion with no sub ID is an exception and nothing is looked up (CT-020)", async () => {
    const store = new MemoryClickStore(new Map([["sub-1", [click("click:a")]]]));
    const result = await matchConversion(store, input({ subId: null }));
    expect(result).toEqual({ kind: "exception", conversionId, reason: "no_click" });
    expect(store.calls).toEqual([]);
  });

  test("a click outside the window is an exception with reason window (TP-W6-023)", async () => {
    const stale = click("click:old", { occurredAt: new Date(occurredAt.getTime() - ATTRIBUTION_WINDOW_MS - 1) });
    const store = new MemoryClickStore(new Map([["sub-1", [stale]]]));
    expect(await matchConversion(store, input())).toEqual({ kind: "exception", conversionId, reason: "window" });
  });

  test("the window edge is inside: a click exactly one window before the conversion matches", async () => {
    const edge = click("click:edge", { occurredAt: new Date(occurredAt.getTime() - ATTRIBUTION_WINDOW_MS) });
    const store = new MemoryClickStore(new Map([["sub-1", [edge]]]));
    expect(await matchConversion(store, input())).toMatchObject({ kind: "attributed", clickDedupKey: "click:edge" });
  });

  test("a click after the conversion is never a match", async () => {
    const later = click("click:later", { occurredAt: new Date(occurredAt.getTime() + 1) });
    const store = new MemoryClickStore(new Map([["sub-1", [later]]]));
    expect(await matchConversion(store, input())).toEqual({ kind: "exception", conversionId, reason: "window" });
  });

  test("two possible clicks resolve to the latest one before the conversion, and the rule is recorded (TP-W6-024)", async () => {
    const earlier = click("click:early", { occurredAt: new Date(occurredAt.getTime() - day) });
    const later = click("click:late", {
      linkId: "lnk_01arz3ndektsv4rrffq69g5fbb",
      publisherId: "pub_01arz3ndektsv4rrffq69g5fbb",
      occurredAt: new Date(occurredAt.getTime() - 1000),
    });
    const store = new MemoryClickStore(new Map([["sub-1", [earlier, later]]]));
    const result = await matchConversion(store, input());
    expect(result).toEqual({
      kind: "attributed",
      linkId: "lnk_01arz3ndektsv4rrffq69g5fbb",
      publisherId: "pub_01arz3ndektsv4rrffq69g5fbb",
      clickDedupKey: "click:late",
      rule: "last_click_in_window",
    });
  });

  test("the same result whatever order the candidates arrive in", async () => {
    const a = click("click:a", { occurredAt: new Date(occurredAt.getTime() - 5000) });
    const b = click("click:b", { occurredAt: new Date(occurredAt.getTime() - 5000) });
    const forward = await matchConversion(new MemoryClickStore(new Map([["sub-1", [a, b]]])), input());
    const reverse = await matchConversion(new MemoryClickStore(new Map([["sub-1", [b, a]]])), input());
    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({ clickDedupKey: "click:a" });
  });

  test("a click that is out of window is ignored when another in-window click exists", async () => {
    const stale = click("click:old", { occurredAt: new Date(occurredAt.getTime() - ATTRIBUTION_WINDOW_MS - day) });
    const fresh = click("click:new", { occurredAt: new Date(occurredAt.getTime() - 10) });
    const store = new MemoryClickStore(new Map([["sub-1", [stale, fresh]]]));
    expect(await matchConversion(store, input())).toMatchObject({ clickDedupKey: "click:new" });
  });

  test("the window is 30 days", () => {
    expect(ATTRIBUTION_WINDOW_MS).toBe(30 * day);
  });
});
