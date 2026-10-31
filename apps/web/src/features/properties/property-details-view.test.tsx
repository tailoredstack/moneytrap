import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyDetailsView } from "./property-details-view";

const ASOF = "2026-10-31T12:04:00.000Z";

// TP-W3-030 and SKELETONS §2.4: a decision made in another tab shows a refresh prompt and does not overwrite the page silently.
describe("PropertyDetailsView (TP-W3-030, UI-025)", () => {
  test("a stale page offers a refresh and keeps the last values visible", () => {
    const html = renderToStaticMarkup(
      <PropertyDetailsView domain="news.example.com" status="verified" asOf={ASOF} stale changedElsewhere />,
    );
    expect(html).toMatch(
      /role="status"[\s\S]*This property changed in another tab\. Refresh to see the latest status\./,
    );
    expect(html).toContain("Refresh");
    expect(html).toContain("Verified");
  });

  test("submit for review is disabled while the page is stale, so nothing is overwritten silently", () => {
    const html = renderToStaticMarkup(
      <PropertyDetailsView domain="news.example.com" status="verified" asOf={ASOF} stale changedElsewhere />,
    );
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Submit for review<\/button>/);
  });

  test("submit for review is enabled only when verified and fresh", () => {
    const html = renderToStaticMarkup(<PropertyDetailsView domain="news.example.com" status="verified" asOf={ASOF} />);
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Submit for review<\/button>/);
  });

  test("an unverified property cannot be submitted", () => {
    const html = renderToStaticMarkup(
      <PropertyDetailsView domain="news.example.com" status="verification_pending" asOf={ASOF} />,
    );
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Submit for review<\/button>/);
  });

  test("says the property is not monetizable until approved", () => {
    const html = renderToStaticMarkup(<PropertyDetailsView domain="news.example.com" status="verified" asOf={ASOF} />);
    expect(html).toContain("Monetizable: No: approval pending.");
  });
});
