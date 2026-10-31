import { describe, expect, test } from "bun:test";
import { createDnsResolver } from "./dns-resolver";

function nodeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("TP-W3-010 DNS resolver adapter", () => {
  test("joins each TXT record's chunks into one value", async () => {
    const resolver = createDnsResolver({
      lookup: async () => [["moneytrap-verification=", "token-1"], ["other"]],
    });
    expect(await resolver.resolveTxt("_moneytrap-verification.example.com")).toEqual([
      "moneytrap-verification=token-1",
      "other",
    ]);
  });

  test("a name with no records resolves to an empty list, not an error", async () => {
    for (const code of ["ENOTFOUND", "ENODATA"]) {
      const resolver = createDnsResolver({
        lookup: async () => {
          throw nodeError(code);
        },
      });
      expect(await resolver.resolveTxt("_moneytrap-verification.example.com")).toEqual([]);
    }
  });

  test("other lookup failures are rethrown so the action can report the provider as unavailable", async () => {
    const resolver = createDnsResolver({
      lookup: async () => {
        throw nodeError("SERVFAIL");
      },
    });
    await expect(resolver.resolveTxt("_moneytrap-verification.example.com")).rejects.toThrow("SERVFAIL");
  });

  test("a lookup that runs past the timeout rejects", async () => {
    const resolver = createDnsResolver({
      timeoutMs: 10,
      lookup: () => new Promise(() => {}),
    });
    await expect(resolver.resolveTxt("_moneytrap-verification.example.com")).rejects.toThrow("timed out");
  });
});
