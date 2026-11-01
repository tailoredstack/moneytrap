import type { PayoutPolicyStore, PublishPolicyResult } from "@moneytrap/app/src/ports/payout-policy-store";
import type { CurrencyCode, PayoutPolicy } from "@moneytrap/domain";

/** In-memory reference adapter for the payout policy store. It applies the same version rules as the Postgres adapter. */
export class FakePayoutPolicyStore implements PayoutPolicyStore {
  readonly policies: PayoutPolicy[] = [];

  async publish({ policy }: { policy: PayoutPolicy }): Promise<PublishPolicyResult> {
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
    this.policies.push({ ...policy });
    return { outcome: "published" };
  }

  async list(currency: CurrencyCode): Promise<PayoutPolicy[]> {
    return this.policies
      .filter((policy) => policy.currency === currency)
      .sort((a, b) => a.version - b.version)
      .map((policy) => ({ ...policy }));
  }
}
