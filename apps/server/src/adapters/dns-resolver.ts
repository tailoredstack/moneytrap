import { resolveTxt as nodeResolveTxt } from "node:dns/promises";
import type { DnsResolver } from "@moneytrap/app/src/ports/dns-resolver";

// Node reports a name with no records as one of these codes. That is an answer ("nothing published yet"), not an outage.
const NO_RECORDS = new Set(["ENOTFOUND", "ENODATA"]);
const DEFAULT_TIMEOUT_MS = 5_000;

export function createDnsResolver(
  options: { lookup?: (name: string) => Promise<string[][]>; timeoutMs?: number } = {},
): DnsResolver {
  const lookup = options.lookup ?? nodeResolveTxt;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async resolveTxt(name) {
      try {
        const records = await withTimeout(lookup(name), timeoutMs);
        // A TXT record can be split into chunks. Its value is the chunks joined, not a list of pieces.
        return records.map((chunks) => chunks.join(""));
      } catch (error) {
        if (NO_RECORDS.has((error as NodeJS.ErrnoException).code ?? "")) return [];
        throw error;
      }
    },
  };
}

// Bounds a lookup so an unresponsive resolver cannot hold a verification request open (UC07).
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`DNS lookup timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
