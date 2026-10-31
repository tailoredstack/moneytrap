import { describe, expect, test } from "bun:test";
import type { ClickBurst, RiskFlagStore, RiskFlagWrite, RiskFlagWriteOutcome } from "../ports/risk-flag-store";
import { BASELINE_RISK_POLICY_VERSION, flagBaselineRisks } from "./flag-clicks";

// Models the adapter contract: one flag per rule, link and subject. It holds bursts as the click facts would give them.
class MemoryRiskFlagStore implements RiskFlagStore {
  flags = new Map<string, RiskFlagWrite>();

  constructor(private readonly bursts: ClickBurst[]) {}

  async findClickBursts(): Promise<ClickBurst[]> {
    return this.bursts;
  }

  async raise(flag: RiskFlagWrite): Promise<RiskFlagWriteOutcome> {
    const key = `${flag.ruleCode}|${flag.linkId}|${flag.subjectKey}`;
    if (this.flags.has(key)) return "existing";
    this.flags.set(key, flag);
    return "raised";
  }
}

const linkId = "lnk_01arz3ndektsv4rrffq69g5fav";
const since = new Date("2026-03-01T00:00:00.000Z");
const at = new Date("2026-03-01T10:00:00.000Z");

describe("baseline risk flags (TP-W5-038, WP-5.10)", () => {
  test("a burst of distinct clicks at one instant raises one duplicate-click flag", async () => {
    const store = new MemoryRiskFlagStore([{ linkId, occurredAt: at, dedupKeys: ["click:a", "click:b"] }]);
    expect(await flagBaselineRisks(store, { since })).toEqual({ raised: 1, existing: 0 });

    const [flag] = store.flags.values();
    expect(flag).toEqual({
      linkId,
      ruleCode: "duplicate_click",
      subjectKey: at.toISOString(),
      severity: "review",
      policyVersion: BASELINE_RISK_POLICY_VERSION,
      evidence: { occurredAt: at.toISOString(), clickCount: 2, dedupKeys: ["click:a", "click:b"] },
    });
  });

  test("a single click raises nothing", async () => {
    const store = new MemoryRiskFlagStore([{ linkId, occurredAt: at, dedupKeys: ["click:a"] }]);
    expect(await flagBaselineRisks(store, { since })).toEqual({ raised: 0, existing: 0 });
    expect(store.flags.size).toBe(0);
  });

  test("rescanning the same clicks raises nothing new", async () => {
    const store = new MemoryRiskFlagStore([{ linkId, occurredAt: at, dedupKeys: ["click:a", "click:b"] }]);
    await flagBaselineRisks(store, { since });
    expect(await flagBaselineRisks(store, { since })).toEqual({ raised: 0, existing: 1 });
    expect(store.flags.size).toBe(1);
  });

  test("a burst on one link and a burst on another link are flagged separately", async () => {
    const other = "lnk_01arz3ndektsv4rrffq69g5fbb";
    const store = new MemoryRiskFlagStore([
      { linkId, occurredAt: at, dedupKeys: ["click:a", "click:b"] },
      { linkId: other, occurredAt: at, dedupKeys: ["click:c", "click:d"] },
    ]);
    expect(await flagBaselineRisks(store, { since })).toEqual({ raised: 2, existing: 0 });
  });
});
