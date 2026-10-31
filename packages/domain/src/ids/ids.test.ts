import { describe, expect, test } from "bun:test";
import { ID_PREFIXES, parseId } from "./ids";

const body = "0123456789abcdefghjkmnpqrs";

describe("typed IDs", () => {
  test("an ID carries the prefix of its own type", () => {
    const id = parseId("link", `lnk_${body}`);
    expect(id as string).toBe(`lnk_${body}`);
  });

  test("an ID of another type is rejected", () => {
    expect(parseId("publisher", `lnk_${body}`)).toBeNull();
  });

  test("malformed IDs are rejected", () => {
    expect(parseId("link", `lnk_${body.toUpperCase()}`)).toBeNull();
    expect(parseId("link", `lnk_short`)).toBeNull();
    expect(parseId("link", `lnk_${body}!`)).toBeNull();
    expect(parseId("link", 42)).toBeNull();
    expect(parseId("link", undefined)).toBeNull();
  });

  test("every type has a distinct prefix", () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
