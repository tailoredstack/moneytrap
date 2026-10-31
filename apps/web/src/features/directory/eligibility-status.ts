// Program decisions as the screens read them. The policy (WP-4.8) returns allow or deny with reasons. The web app
// restates the labels, as the property screens do, so it does not import server code.
export const DENY_REASONS = [
  "publisher_not_approved",
  "property_not_approved",
  "unknown",
  "program_not_approved",
  "contract",
  "geography",
  "channel",
  "consent",
] as const;

export type DenyReason = (typeof DENY_REASONS)[number];

export type EligibilityDecision = { decision: "allow" } | { decision: "deny"; reasons: readonly DenyReason[] };

export const REASON_LABELS: Record<DenyReason, string> = {
  publisher_not_approved: "Your publisher account is not approved",
  property_not_approved: "Your property is not approved",
  unknown: "The network has not reported approval for this program",
  program_not_approved: "The program has not approved this property",
  contract: "No active contract with this network",
  geography: "The program does not allow your country",
  channel: "The program does not allow this channel",
  consent: "Consent is required for this program",
};

// Unknown is shown as its own status, not as a denial, so a publisher does not read a missing answer as a final no.
export function statusText(decision: EligibilityDecision): string {
  if (decision.decision === "allow") return "Eligible";
  if (decision.reasons.includes("unknown")) return "Unknown";
  const [first] = decision.reasons;
  return first ? `Not eligible: ${REASON_LABELS[first]}` : "Not eligible";
}

// Eligible programs open; every other row asks why, which opens the same terms screen with the reasons.
export function actionLabel(decision: EligibilityDecision): "Open" | "Why?" {
  return decision.decision === "allow" ? "Open" : "Why?";
}
