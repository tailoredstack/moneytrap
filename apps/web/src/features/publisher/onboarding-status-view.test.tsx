import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OnboardingStatusView } from "./onboarding-status-view";
import { PUBLISHER_STATUSES, type PublisherStatus } from "./publisher-status";

const ASOF = "2026-10-31T12:04:00.000Z";

// TP-W3-027 and SKELETONS §2.1: the onboarding status screen renders every publisher state.
describe("OnboardingStatusView (TP-W3-027, UI-005, UI-016)", () => {
  const expectedLabel: Record<PublisherStatus, string> = {
    draft: "Not started",
    submitted: "Submitted",
    in_review: "In review",
    approved: "Approved",
    rejected: "Rejected",
    suspended: "Suspended",
  };

  for (const status of PUBLISHER_STATUSES) {
    test(`renders the ${status} state with its label`, () => {
      const html = renderToStaticMarkup(<OnboardingStatusView status={status} asOf={ASOF} />);
      expect(html).toContain(expectedLabel[status]);
      expect(html).toContain("Step 4");
    });
  }

  test("shows the rejection reason when the publisher was rejected", () => {
    const html = renderToStaticMarkup(
      <OnboardingStatusView status="rejected" asOf={ASOF} rejectionReason="Registry extract does not match." />,
    );
    expect(html).toContain("Registry extract does not match.");
  });

  test("keeps properties locked until approval", () => {
    const html = renderToStaticMarkup(<OnboardingStatusView status="in_review" asOf={ASOF} />);
    expect(html).toContain("locked until approval");
  });

  test("marks stale data and keeps the last values visible", () => {
    const html = renderToStaticMarkup(<OnboardingStatusView status="submitted" asOf={ASOF} stale />);
    expect(html).toContain("data stale");
    expect(html).toContain("Submitted");
  });
});
