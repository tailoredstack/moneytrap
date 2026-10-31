import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { decodeCursor, encodeCursor, PageParamsSchema, pageSchema } from "./pagination";

const ItemSchema = Type.Object({ id: Type.String() });

describe("pagination", () => {
  test("TP-W1-028 rejects a page size above the limit", () => {
    expect(Value.Check(PageParamsSchema, { limit: 100 })).toBe(true);
    expect(Value.Check(PageParamsSchema, { limit: 101 })).toBe(false);
    expect(Value.Check(PageParamsSchema, { limit: 0 })).toBe(false);
  });

  test("cursor is an opaque string and round-trips through encode and decode", () => {
    const cursor = encodeCursor({ after: "2026-01-01T00:00:00Z|item_42" });
    expect(typeof cursor).toBe("string");
    expect(cursor).not.toContain("item_42");
    expect(decodeCursor(cursor)).toEqual({ after: "2026-01-01T00:00:00Z|item_42" });
  });

  test("decodeCursor rejects a tampered or unrelated value", () => {
    expect(decodeCursor("not-a-cursor!!")).toBeNull();
    expect(decodeCursor(`${encodeCursor({ after: "x" })}A`)).toBeNull();
  });

  test("page schema types next_cursor as an opaque string or null", () => {
    const PageSchema = pageSchema(ItemSchema);
    expect(Value.Check(PageSchema, { data: [{ id: "a" }], meta: { next_cursor: encodeCursor({ after: "a" }) } })).toBe(
      true,
    );
    expect(Value.Check(PageSchema, { data: [], meta: { next_cursor: null } })).toBe(true);
    expect(Value.Check(PageSchema, { data: [], meta: { next_cursor: 7 } })).toBe(false);
  });
});
