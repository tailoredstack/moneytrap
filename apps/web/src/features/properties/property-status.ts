// Property states as the screens show them. The domain's state machine is WP-3.4; the web app restates the labels.
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

export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  draft: "Draft",
  verification_pending: "Verify DNS",
  verified: "Verified",
  review_pending: "Review pending",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};

// Only an approved property may be monetized (SKELETONS §2.4). A verified one is not approved yet.
export function isMonetizable(status: PropertyStatus): boolean {
  return status === "approved";
}
