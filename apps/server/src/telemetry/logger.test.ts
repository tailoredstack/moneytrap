import { describe, expect, test } from "bun:test";
import { createLogger, REDACTED, redact } from "./logger";

describe("redact", () => {
  test("replaces the value of token-shaped keys at any depth", () => {
    const out = redact({
      access_token: "abc",
      nested: { apiKey: "k", Password: "p", session_secret: "s", cookie: "c" },
      list: [{ refreshToken: "r" }],
    });

    expect(out).toEqual({
      access_token: REDACTED,
      nested: { apiKey: REDACTED, Password: REDACTED, session_secret: REDACTED, cookie: REDACTED },
      list: [{ refreshToken: REDACTED }],
    });
  });

  test("redacts Authorization-style bearer strings even under innocent keys", () => {
    expect(redact({ header: "Bearer abc.def.ghi" })).toEqual({ header: REDACTED });
  });

  test("masks credentials embedded in URLs under any key", () => {
    const out = redact({ message: "connect redis://user:hunter2@cache:6379 failed", url: "https://u:p@host/x" });

    expect(out).toEqual({
      message: `connect redis://${REDACTED}@cache:6379 failed`,
      url: `https://${REDACTED}@host/x`,
    });
  });

  test("keeps ordinary fields and does not mutate the input", () => {
    const input = { request_id: "req-1", count: 2, token: "t" };

    expect(redact(input)).toEqual({ request_id: "req-1", count: 2, token: REDACTED });
    expect(input.token).toBe("t");
  });

  test("handles circular references without overflowing", () => {
    const loop: Record<string, unknown> = { name: "loop" };
    loop.self = loop;

    expect(redact(loop)).toEqual({ name: "loop", self: "[Circular]" });
  });
});

describe("createLogger", () => {
  test("writes one JSON line per entry with the level, message, and redacted fields", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));

    log.info("payout queued", { request_id: "req-1", secret: "shh" });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      level: "info",
      message: "payout queued",
      request_id: "req-1",
      secret: REDACTED,
    });
  });

  test("emits every level and never leaks a token passed as the message", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));

    log.debug("d");
    log.warn("w");
    log.error("e", { authorization: "Bearer xyz" });

    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["debug", "warn", "error"]);
    expect(lines.join("\n")).not.toContain("xyz");
  });
});
