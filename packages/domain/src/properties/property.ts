import type { ErrorCode } from "../errors/codes";
import type { Id } from "../ids/ids";

// Property states from DM-011 and spec §5 (Property). Verification proves ownership; approval is a separate review.
// Only `approved` properties may be monetized, so a verified property is never treated as approved.
export const PROPERTY_STATUSES = [
  "draft",
  "verification_pending",
  "verified",
  "review_pending",
  "approved",
  "rejected",
  "suspended",
] as const;

export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export interface Property {
  readonly id: Id<"property">;
  readonly publisherId: Id<"publisher">;
  readonly type: "website";
  readonly canonicalIdentifier: string;
  readonly normalizedIdentifier: string;
  readonly status: PropertyStatus;
  readonly rejectionReason?: string;
}

export type PropertyTransition = { ok: true; value: Property } | { ok: false; code: ErrorCode };

// A new website property always starts in draft. The identifier must not be blank.
export function createWebsiteProperty(input: {
  id: Id<"property">;
  publisherId: Id<"publisher">;
  canonicalIdentifier: string;
}): PropertyTransition {
  const normalizedIdentifier = input.canonicalIdentifier.trim().toLowerCase();
  if (normalizedIdentifier === "") return { ok: false, code: "VALIDATION_FAILED" };
  return {
    ok: true,
    value: {
      id: input.id,
      publisherId: input.publisherId,
      type: "website",
      canonicalIdentifier: input.canonicalIdentifier,
      normalizedIdentifier,
      status: "draft",
    },
  };
}

export function requestPropertyVerification(property: Property): PropertyTransition {
  return move(property, "draft", "verification_pending");
}

export function markPropertyVerified(property: Property): PropertyTransition {
  return move(property, "verification_pending", "verified");
}

export function submitPropertyForReview(property: Property): PropertyTransition {
  return move(property, "verified", "review_pending");
}

export function approveProperty(property: Property): PropertyTransition {
  return move(property, "review_pending", "approved");
}

// A rejection must say why, so the publisher and the audit trail can see the reason.
export function rejectProperty(property: Property, reason: string): PropertyTransition {
  if (property.status !== "review_pending") return { ok: false, code: "STATE_CONFLICT" };
  if (reason.trim() === "") return { ok: false, code: "VALIDATION_FAILED" };
  return { ok: true, value: { ...property, status: "rejected", rejectionReason: reason } };
}

// Suspension stops monetization. Only reinstateProperty leaves `suspended`.
export function suspendProperty(property: Property): PropertyTransition {
  return move(property, "approved", "suspended");
}

// Reinstatement restores a suspended property to approved. The reason is recorded by the caller in the audit row.
export function reinstateProperty(property: Property): PropertyTransition {
  return move(property, "suspended", "approved");
}

// Only an approved property may be monetized (CT-006). A verified property is owned but not yet approved.
export function isMonetizable(property: Property): boolean {
  return property.status === "approved";
}

// The reason an action that monetizes a property (for example, a link create in WP-5.2) is denied, or null when allowed.
export function monetizationDenial(property: Property): "not approved" | null {
  return isMonetizable(property) ? null : "not approved";
}

// Every transition returns a new value. An illegal move is a STATE_CONFLICT and leaves the input untouched.
function move(property: Property, from: PropertyStatus, to: PropertyStatus): PropertyTransition {
  if (property.status !== from) return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: { ...property, status: to } };
}
