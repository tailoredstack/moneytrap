import type { ProgramFactPayload } from "../catalog/source-fact";
import type { PropertyStatus } from "../properties/property";
import type { PublisherStatus } from "../publisher/publisher";

// Eligibility policy (spec §3 Eligibility; DM-023 to DM-025). Pure: no clock, no I/O, no persistence. A monetized route
// is allowed only when every rule passes. Unknown or missing facts deny, so a gap in the catalog never becomes a route.
// Version 1 is recorded with each decision (WP-4.9), so a later policy change can be traced to the rule set that ran.
export const ELIGIBILITY_POLICY_VERSION = 1;

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

export interface EligibilityInput {
  publisher: { status: PublisherStatus };
  property: { status: PropertyStatus };
  // The network-reported program facts (WP-4.5). Approval comes only from the network, never from a publisher action.
  program: Pick<ProgramFactPayload, "approval" | "countries" | "channels">;
  // The country the monetized traffic is routed to, and the channel it arrives through.
  geography: string;
  channel: string;
  // The network contract that the publisher is operating under: whether it is in force, and where it permits traffic.
  contract: { active: boolean; countries: readonly string[]; channels: readonly string[] };
  // Consent is evaluated only when the caller marks it required (for example, when Optimize is on). In M3 it is not.
  consent: { required: boolean; granted: boolean };
}

export interface RuleCheck {
  reason: DenyReason;
  passed: boolean;
}

export type EligibilityDecision =
  | { decision: "allow"; policyVersion: number; checks: readonly RuleCheck[] }
  | { decision: "deny"; policyVersion: number; reasons: readonly DenyReason[]; checks: readonly RuleCheck[] };

// Every rule is evaluated, so a denial reports all the reasons at once. The checks list is the evidence for either outcome.
export function evaluateEligibility(input: EligibilityInput): EligibilityDecision {
  const checks: RuleCheck[] = [
    { reason: "publisher_not_approved", passed: input.publisher.status === "approved" },
    { reason: "property_not_approved", passed: input.property.status === "approved" },
    approvalCheck(input.program.approval),
    { reason: "contract", passed: input.contract.active },
    ...dimensionCheck("geography", input.geography, input.program.countries, input.contract.countries),
    ...dimensionCheck("channel", input.channel, input.program.channels, input.contract.channels),
    { reason: "consent", passed: !input.consent.required || input.consent.granted },
  ];

  const reasons = [...new Set(checks.filter((check) => !check.passed).map((check) => check.reason))];
  // DENY_REASONS fixes the order, so the reasons come back in the same order every time.
  const ordered = DENY_REASONS.filter((reason) => reasons.includes(reason));

  if (ordered.length === 0) return { decision: "allow", policyVersion: ELIGIBILITY_POLICY_VERSION, checks };
  return { decision: "deny", policyVersion: ELIGIBILITY_POLICY_VERSION, reasons: ordered, checks };
}

// Only an explicit `approved` passes. A missing value is unknown; `pending` and `rejected` are a known "not approved".
function approvalCheck(approval: ProgramFactPayload["approval"]): RuleCheck {
  if (approval === null) return { reason: "unknown", passed: false };
  return { reason: "program_not_approved", passed: approval === "approved" };
}

// A blank value is unknown, so the list lookup is not attempted. Both the program and the contract must permit the value.
function dimensionCheck(
  reason: "geography" | "channel",
  value: string,
  programValues: readonly string[],
  contractValues: readonly string[],
): RuleCheck[] {
  const normalised = normalise(value);
  if (normalised === "") return [{ reason: "unknown", passed: false }];
  const permitted = (values: readonly string[]) => values.some((candidate) => normalise(candidate) === normalised);
  return [{ reason, passed: permitted(programValues) && permitted(contractValues) }];
}

// Country codes and channel names are compared without case or surrounding space.
function normalise(value: string): string {
  return value.trim().toLowerCase();
}
