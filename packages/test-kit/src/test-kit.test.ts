import { expect, test } from "bun:test";
import { parseId } from "@moneytrap/domain";
import { FakeClock, FakeIdGenerator, fixtureCtx, fixtureId } from "./index";

test("TP-W1-031 fake clock advances only when asked and returns independent dates", () => {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const first = clock.now();
  first.setFullYear(2030);
  expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  clock.advance({ hours: 1 });
  expect(clock.now().toISOString()).toBe("2026-01-01T01:00:00.000Z");
  expect(() => clock.advance({ hours: -1 })).toThrow();
  expect(() => clock.advance({ seconds: Number.NaN })).toThrow();
});

test("fake IDs are typed, deterministic, and count separately per kind", () => {
  const ids = new FakeIdGenerator();
  expect(ids.next("user")).toBe(fixtureId("user", 1));
  expect(ids.next("link")).toBe(fixtureId("link", 1));
  expect(ids.next("user")).toBe(fixtureId("user", 2));
  expect(parseId("user", ids.next("user"))).not.toBeNull();
  expect(() => fixtureId("user", 0)).toThrow();
});

test("context fixtures keep independent clocks and ID sequences", () => {
  const db = {} as Parameters<typeof fixtureCtx>[0];
  const first = fixtureCtx(db);
  const second = fixtureCtx(db);
  (first.clock as FakeClock).advance({ hours: 1 });
  expect(first.clock.now().toISOString()).toBe("2020-01-01T01:00:00.000Z");
  expect(second.clock.now().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  expect(first.ids.next("user")).toBe(second.ids.next("user"));
  expect(first.actor).toEqual({ type: "system", id: null });
});
