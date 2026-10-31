import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { decodeCursor, encodeCursor, PageParamsSchema, pageSchema } from "./pagination";

const KEY = "test-cursor-key";
const ItemSchema = Type.Object({ id: Type.String() });

describe("pagination", () => {
  test("TP-W1-028 rejects a page size above the limit", () => {
    expect(Value.Check(PageParamsSchema, { limit: 100 })).toBe(true);
    expect(Value.Check(PageParamsSchema, { limit: 101 })).toBe(false);
    expect(Value.Check(PageParamsSchema, { limit: 0 })).toBe(false);
  });

  test("cursor is an opaque string and round-trips through encode and decode", () => {
    const cursor = encodeCursor({ after: "2026-01-01T00:00:00Z|item_42" }, KEY);
    expect(typeof cursor).toBe("string");
    expect(cursor).not.toContain("item_42");
    expect(decodeCursor(cursor, KEY)).toEqual({ after: "2026-01-01T00:00:00Z|item_42" });
  });

  test("decodeCursor rejects a malformed value", () => {
    expect(decodeCursor("not-a-cursor!!", KEY)).toBeNull();
    expect(decodeCursor("", KEY)).toBeNull();
  });

  test("decodeCursor rejects a cursor whose position was edited", () => {
    const [, signature] = encodeCursor({ after: "a" }, KEY).split(".");
    const forged = Buffer.from(JSON.stringify({ after: "z" })).toString("base64url");
    expect(decodeCursor(`${forged}.${signature}`, KEY)).toBeNull();
  });

  test("decodeCursor rejects a cursor signed with a different key", () => {
    expect(decodeCursor(encodeCursor({ after: "a" }, "other-key"), KEY)).toBeNull();
  });

  test("page schema types next_cursor as an opaque string or null", () => {
    const PageSchema = pageSchema(ItemSchema);
    expect(
      Value.Check(PageSchema, { data: [{ id: "a" }], meta: { next_cursor: encodeCursor({ after: "a" }, KEY) } }),
    ).toBe(true);
    expect(Value.Check(PageSchema, { data: [], meta: { next_cursor: null } })).toBe(true);
    expect(Value.Check(PageSchema, { data: [], meta: { next_cursor: 7 } })).toBe(false);
  });
});
