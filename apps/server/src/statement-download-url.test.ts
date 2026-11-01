import { describe, expect, test } from "bun:test";
import { signStatementDownloadUrl } from "./statement-download-url";

describe("statement download URL signer", () => {
  test("signs the encoded path with a five-minute expiry using the supplied clock", async () => {
    const url = new URL(
      await signStatementDownloadUrl("statements/a b.json", {
        baseUrl: "https://objects.example.test/bucket",
        secret: "test-secret",
        now: new Date("2026-11-02T00:00:00.000Z"),
      }),
    );
    expect(url.pathname).toBe("/bucket/statements/a%20b.json");
    expect(url.searchParams.get("expires")).toBe(String(Date.parse("2026-11-02T00:00:00.000Z") / 1000 + 300));
    expect(url.searchParams.get("signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("fails closed without signing configuration or with a non-HTTPS endpoint", async () => {
    await expect(signStatementDownloadUrl("a", { now: new Date() })).rejects.toThrow("not configured");
    await expect(
      signStatementDownloadUrl("a", { baseUrl: "http://objects.test", secret: "secret", now: new Date() }),
    ).rejects.toThrow("must use HTTPS");
  });
  test("rejects dot-segment and empty object reference segments", async () => {
    for (const objectRef of ["../private.json", "statements/../private.json", "statements//one.json", "./one.json"]) {
      await expect(
        signStatementDownloadUrl(objectRef, { baseUrl: "https://objects.test/", secret: "secret", now: new Date() }),
      ).rejects.toThrow("invalid statement object reference");
    }
  });
});
