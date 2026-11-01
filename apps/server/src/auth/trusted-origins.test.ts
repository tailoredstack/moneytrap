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

  test("never echoes an entry that may carry credentials, whatever its shape", () => {
    const entries = [
      "http://admin:hunter2@localhost:3000",
      "http://admin:hun/ter2@localhost:3000",
      "http://admin:hun?ter2@localhost:3000",
      "http://admin:hun#ter2@localhost:3000",
      "http://u:p@ss@localhost:3000",
      "admin:hunter2@localhost:3000",
      "http:/admin:hunter2@localhost:3000",
      "http:\\\\admin:hunter2@localhost:3000",
      "x http://admin:hunter2@localhost:3000",
    ];
    for (const entry of entries) {
      let message = "";
      try {
        trustedOrigins(entry);
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain("TRUSTED_ORIGINS must be");
      expect(message).toContain("entry 1 is not valid (not shown, it contains an @)");
      expect(message).not.toContain("admin");
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("ter2");
    }
  });

  test("names the position and the text of a bad entry that has no @", () => {
    expect(() => trustedOrigins("http://localhost:3000, ftp://example.test")).toThrow(
      'entry 2 is not valid ("ftp://example.test")',
    );
  });
});
