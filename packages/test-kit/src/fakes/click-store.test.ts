import { describe, expect, test } from "bun:test";
import { FakeClickStore } from "./click-store";

const click = (dedupKey: string) => ({
  dedupKey,
  linkId: "lnk_01arz3ndektsv4rrffq69g5fav",
  occurredAt: new Date("2026-03-01T10:00:00.000Z"),
});

describe("fake click store (TP-W5-033, CT-013)", () => {
  test("keeps one fact per dedup key and reports the duplicate", async () => {
    const store = new FakeClickStore();
    expect(await store.record(click("click:a"))).toBe("recorded");
    expect(await store.record(click("click:a"))).toBe("duplicate");
    expect(store.recorded().map((c) => c.dedupKey)).toEqual(["click:a"]);
  });

  test("keeps distinct keys", async () => {
    const store = new FakeClickStore();
    await store.record(click("click:a"));
    await store.record(click("click:b"));
    expect(store.recorded()).toHaveLength(2);
  });
});
