// (no domain money imports needed here)

// A share rule splits recognized revenue among publisher/platform/other.
// Percentages are integer basis points (10000 = 100%).
export type ShareRule = {
  readonly publisherBps: number;
  readonly platformBps: number;
  readonly otherBps: number;
  readonly roundingVersion: number;
};

export function createShareRule(
  publisherBps: number,
  platformBps: number,
  otherBps: number,
  roundingVersion: number,
): ShareRule {
  if (publisherBps < 0 || platformBps < 0 || otherBps < 0) {
    throw new Error("share bps must be non-negative");
  }
  if (publisherBps + platformBps + otherBps !== 10000) {
    throw new Error("share bps must sum to 10000");
  }
  if (!Number.isInteger(roundingVersion) || roundingVersion < 1) {
    throw new Error("roundingVersion must be a positive integer");
  }
  return { publisherBps, platformBps, otherBps, roundingVersion };
}

export type { Allocation } from "./allocate";
// re-export for convenience
export { allocate } from "./allocate";
