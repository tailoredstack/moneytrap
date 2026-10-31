import { describe, expect, test } from "bun:test";
import { formatTimestamp } from "./load-state";

// The visible copy names the UTC instant, so a timestamp with an offset is not mislabelled.
describe("formatTimestamp", () => {
  test("a Z timestamp is shown as UTC", () => {
    expect(formatTimestamp("2026-10-31T09:04:00.000Z")).toBe("2026-10-31 09:04 UTC");
  });

  test("an offset timestamp is converted to the UTC instant it names", () => {
    expect(formatTimestamp("2026-10-31T12:04:00+02:00")).toBe("2026-10-31 10:04 UTC");
  });

  test("an unparseable value is shown as given rather than thrown", () => {
    expect(formatTimestamp("not a date")).toBe("not a date");
  });
});
