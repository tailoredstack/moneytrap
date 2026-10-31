import { describe, expect, test } from "bun:test";
import { decideReplay, type StoredResponse } from "./idempotency";

const stored: StoredResponse = { requestHash: "hash-a", status: 201, body: '{"id":"pay_1"}' };

describe("decideReplay", () => {
  test("no stored response is a miss, so the effect runs", () => {
    expect(decideReplay(null, "hash-a")).toEqual({ kind: "miss" });
  });

  test("same request hash replays the stored status and body", () => {
    expect(decideReplay(stored, "hash-a")).toEqual({ kind: "replay", status: 201, body: '{"id":"pay_1"}' });
  });

  test("different request hash is a conflict", () => {
    expect(decideReplay(stored, "hash-b")).toEqual({ kind: "conflict" });
  });
});
