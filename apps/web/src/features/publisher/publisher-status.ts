// Publisher states as the screens show them. Labels are text, so no screen relies on colour alone (SKELETONS §0).
// The list mirrors the domain's publisher states; the web app does not import server code, so it is restated here.
export const PUBLISHER_STATUSES = ["draft", "submitted", "in_review", "approved", "rejected", "suspended"] as const;

export type PublisherStatus = (typeof PUBLISHER_STATUSES)[number];

export const PUBLISHER_STATUS_LABELS: Record<PublisherStatus, string> = {
  draft: "Not started",
  submitted: "Submitted",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};
