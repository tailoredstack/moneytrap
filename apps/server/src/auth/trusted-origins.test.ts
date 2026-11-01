import { describe, expect, test } from "bun:test";
import { trustedOrigins } from "./config";

describe("TRUSTED_ORIGINS policy value", () => {
  test("is empty when the environment does not set it", () => {
    expect(trustedOrigins(undefined)).toEqual([]);
    expect(trustedOrigins("")).toEqual([]);
    expect(trustedOrigins(" , ,")).toEqual([]);
  });

  test("reads a comma-separated list of origins and trims each entry", () => {
    expect(trustedOrigins("http://localhost:3000, http://localhost:5190 ,https://app.example.test")).toEqual([
      "http://localhost:3000",
      "http://localhost:5190",
      "https://app.example.test",
    ]);
  });

  test("lowercases the host and drops duplicates", () => {
    expect(trustedOrigins("http://LocalHost:3000,http://localhost:3000")).toEqual(["http://localhost:3000"]);
  });

  test("rejects an entry that is not an http or https origin", () => {
    const bad = [
      "localhost:3000",
      "ftp://example.test",
      "javascript:alert(1)",
      "null",
      "not a url",
      "http://localhost:3000/",
      "http://localhost:3000/app",
      "http://localhost:3000?x=1",
      "http://localhost:3000#frag",
      "http://user:pass@localhost:3000",
      "http://localhost:80",
    ];
    for (const entry of bad) {
      expect(() => trustedOrigins(entry)).toThrow(
        /^TRUSTED_ORIGINS must be a comma-separated list of http or https origins/,
      );
    }
  });

  test("rejects wildcards, so the list stays explicit", () => {
    for (const entry of ["*", "http://*", "https://*.example.test", "http://localhost:*"]) {
      expect(() => trustedOrigins(entry)).toThrow(
        "TRUSTED_ORIGINS must be a comma-separated list of http or https origins",
      );
    }
  });

  test("one invalid entry refuses the whole list and names the entry", () => {
    expect(() => trustedOrigins("http://localhost:3000,ftp://example.test")).toThrow("ftp://example.test");
  });

  test("does not echo credentials from an entry into the error", () => {
    let message = "";
    try {
      trustedOrigins("http://admin:hunter2@localhost:3000");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("TRUSTED_ORIGINS must be");
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("admin");
  });
});
