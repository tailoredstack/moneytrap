import { describe, expect, test } from "bun:test";
import {
  CHALLENGE_TTL_MS,
  challengeExpiresAt,
  isChallengeExpired,
  VERIFICATION_TXT_PREFIX,
  verificationRecordName,
} from "./verification";

const issuedAt = new Date("2026-03-01T12:00:00.000Z");

describe("TP-W3-009 DNS challenge expiry", () => {
  test("a challenge expires 24 hours after it is issued", () => {
    expect(CHALLENGE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(challengeExpiresAt(issuedAt).toISOString()).toBe("2026-03-02T12:00:00.000Z");
  });

  test("a challenge is still valid one millisecond before its expiry", () => {
    const expiresAt = challengeExpiresAt(issuedAt);
    expect(isChallengeExpired(expiresAt, new Date(expiresAt.getTime() - 1))).toBe(false);
  });

  test("a challenge is expired at its expiry instant", () => {
    const expiresAt = challengeExpiresAt(issuedAt);
    expect(isChallengeExpired(expiresAt, expiresAt)).toBe(true);
  });

  test("the TXT record sits under the verification label of the host", () => {
    expect(verificationRecordName("example.com")).toBe("_moneytrap-verification.example.com");
    expect(VERIFICATION_TXT_PREFIX).toBe("moneytrap-verification=");
  });
});
