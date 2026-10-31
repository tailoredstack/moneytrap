// Risk flags (DM-060, WP-5.10). A flag is evidence that a rule matched recorded click data, for review. The store has no
// method that touches clicks or links, so writing a flag can never block a click or change a link.
export type RiskRuleCode = "duplicate_click";

export type RiskSeverity = "review";

// Distinct clicks on one link that share one occurrence instant. `dedupKeys` names each logical click (DM-030).
export interface ClickBurst {
  linkId: string;
  occurredAt: Date;
  dedupKeys: readonly string[];
}

export interface RiskFlagWrite {
  linkId: string;
  ruleCode: RiskRuleCode;
  // Names the subject the rule matched, so one rule raises at most one flag per link and subject.
  subjectKey: string;
  severity: RiskSeverity;
  policyVersion: number;
  evidence: Record<string, unknown>;
}

// `raised` means this call wrote the flag. `existing` means a flag for the rule, link and subject was already stored.
export type RiskFlagWriteOutcome = "raised" | "existing";

export interface RiskFlagStore {
  // Bursts of clicks whose occurrence is at or after `since`. Each burst has at least one click.
  findClickBursts(since: Date): Promise<ClickBurst[]>;
  raise(flag: RiskFlagWrite): Promise<RiskFlagWriteOutcome>;
}
