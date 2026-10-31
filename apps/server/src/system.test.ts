import { describe, expect, test } from "bun:test";
import { ID_PREFIXES, parseId } from "@moneytrap/domain";
import { randomIds } from "./system";

describe("randomIds", () => {
  test("every generated ID parses as its own kind", () => {
    for (const kind of Object.keys(ID_PREFIXES) as (keyof typeof ID_PREFIXES)[]) {
      const id = randomIds.next(kind);
      expect(parseId(kind, id)).toBe(id);
    }
  });

  test("IDs are distinct", () => {
    expect(randomIds.next("user")).not.toBe(randomIds.next("user"));
  });
});
