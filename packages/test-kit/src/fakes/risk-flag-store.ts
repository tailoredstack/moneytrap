import type {
  ClickBurst,
  RiskFlagStore,
  RiskFlagWrite,
  RiskFlagWriteOutcome,
} from "@moneytrap/app/src/ports/risk-flag-store";

// In-memory stand-in for the risk flag store. Keeps one flag per rule, link and subject, as the Postgres unique key does.
export class FakeRiskFlagStore implements RiskFlagStore {
  private readonly flags = new Map<string, RiskFlagWrite>();

  constructor(private readonly bursts: readonly ClickBurst[] = []) {}

  async findClickBursts(): Promise<ClickBurst[]> {
    return this.bursts.map((burst) => ({ ...burst, dedupKeys: [...burst.dedupKeys] }));
  }

  async raise(flag: RiskFlagWrite): Promise<RiskFlagWriteOutcome> {
    const key = `${flag.ruleCode}|${flag.linkId}|${flag.subjectKey}`;
    if (this.flags.has(key)) return "existing";
    this.flags.set(key, { ...flag });
    return "raised";
  }

  raised(): readonly RiskFlagWrite[] {
    return [...this.flags.values()].map((flag) => ({ ...flag }));
  }
}
