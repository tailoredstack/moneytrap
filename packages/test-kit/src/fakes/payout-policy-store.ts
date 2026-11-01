import type { PayoutPolicyStore, PublishPolicyResult } from "@moneytrap/app/src/ports/payout-policy-store";
import type { CurrencyCode, PayoutPolicy } from "@moneytrap/domain";

/** In-memory reference adapter for the payout policy store. It applies the same version rules as the Postgres adapter. */
// Same bound as the Postgres adapter: a publish time earlier than the write clock less the tolerance is refused.
const WRITE_CLOCK_TOLERANCE_MS = 1000;

export class FakePayoutPolicyStore implements PayoutPolicyStore {
  readonly policies: PayoutPolicy[] = [];
  readonly audit: { action: string; entityId: string; actor: { type: string; id: string } }[] = [];

  constructor(private readonly writeClock: () => Date = () => new Date()) {}

  async publish({
    policy,
    occurredAt,
    actor,
  }: {
    policy: PayoutPolicy;
    occurredAt: Date;
    actor: { type: string; id: string };
  }): Promise<PublishPolicyResult> {
    const now = this.writeClock().getTime();
    // A time outside the window is a typed refusal, as the adapter returns it after taking the lock.
    if (
      occurredAt.getTime() < now - WRITE_CLOCK_TOLERANCE_MS ||
      occurredAt.getTime() > now + WRITE_CLOCK_TOLERANCE_MS
    ) {
      return { outcome: "rejected", reason: "outside_write_clock" };
    }
    const sameCurrency = this.policies.filter((existing) => existing.currency === policy.currency);
    if (sameCurrency.some((existing) => existing.version === policy.version)) {
      return { outcome: "rejected", reason: "version_taken" };
    }
    const latest = sameCurrency.reduce<PayoutPolicy | null>(
      (top, existing) => (top === null || existing.version > top.version ? existing : top),
      null,
    );
    if (latest !== null && policy.version !== latest.version + 1) {
      return { outcome: "rejected", reason: "version_gap" };
    }
    if (latest === null && policy.version !== 1) return { outcome: "rejected", reason: "version_gap" };
    if (latest !== null && policy.effectiveFrom.getTime() < latest.effectiveFrom.getTime()) {
      return { outcome: "rejected", reason: "effective_before_latest" };
    }
    if (latest !== null && policy.effectiveFrom.getTime() < now) {
      return { outcome: "rejected", reason: "effective_in_past" };
    }
    this.policies.push({ ...policy });
    this.audit.push({ action: "payout_policy_published", entityId: `${policy.currency}:${policy.version}`, actor });
    return { outcome: "published" };
  }

  async list(currency: CurrencyCode): Promise<PayoutPolicy[]> {
    return this.policies
      .filter((policy) => policy.currency === currency)
      .sort((a, b) => a.version - b.version)
      .map((policy) => ({ ...policy }));
  }
}
