import type { RiskFlagStore } from "../ports/risk-flag-store";

// Version of the baseline heuristics. Every flag stores it, so a later rule set can be told apart from this one.
export const BASELINE_RISK_POLICY_VERSION = 1;

// A burst is flagged when it holds at least this many distinct clicks at one instant.
const DUPLICATE_CLICK_MIN_CLICKS = 2;

export interface FlagSummary {
  raised: number;
  existing: number;
}

// Flags duplicate-click bursts: distinct clicks on one link at the same instant, which a single visitor does not produce
// (TP-W5-038). Flags are for review. Every click stays counted, and no link changes. A rescan of the same clicks raises
// nothing new, because the store keeps one flag per rule, link and subject.
export async function flagBaselineRisks(store: RiskFlagStore, input: { since: Date }): Promise<FlagSummary> {
  const summary: FlagSummary = { raised: 0, existing: 0 };
  for (const burst of await store.findClickBursts(input.since)) {
    if (burst.dedupKeys.length < DUPLICATE_CLICK_MIN_CLICKS) continue;
    const occurredAt = burst.occurredAt.toISOString();
    const outcome = await store.raise({
      linkId: burst.linkId,
      ruleCode: "duplicate_click",
      subjectKey: occurredAt,
      severity: "review",
      policyVersion: BASELINE_RISK_POLICY_VERSION,
      evidence: { occurredAt, clickCount: burst.dedupKeys.length, dedupKeys: [...burst.dedupKeys] },
    });
    summary[outcome] += 1;
  }
  return summary;
}
