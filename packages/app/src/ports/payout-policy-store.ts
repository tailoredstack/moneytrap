import type { CurrencyCode, PayoutPolicy } from "@moneytrap/domain";

export interface PublishActor {
  type: string;
  id: string;
}

// A published version is final. A version that is taken, skips a number, or takes effect before the latest version is
// refused and nothing is written. That keeps the decisions made under earlier versions reproducible (TP-W7-011).
export type PublishPolicyResult =
  | { outcome: "published" }
  | {
      outcome: "rejected";
      reason: "version_taken" | "version_gap" | "effective_before_latest" | "effective_in_past" | "outside_write_clock";
    };

export interface PayoutPolicyStore {
  publish(input: {
    policy: PayoutPolicy;
    auditId: string;
    organizationId: string;
    actor: PublishActor;
    occurredAt: Date;
  }): Promise<PublishPolicyResult>;
  list(currency: CurrencyCode): Promise<PayoutPolicy[]>;
}
