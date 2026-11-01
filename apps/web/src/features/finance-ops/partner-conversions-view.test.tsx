import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type PartnerConversionsState, PartnerConversionsView } from "./partner-conversions-view";

const render = (state: PartnerConversionsState) => renderToStaticMarkup(<PartnerConversionsView state={state} />);

// UI-041: each conversion shows its status (tracked, pending, approved, reversed), reported-at and source.
describe("PartnerConversionsView (UI-041)", () => {
  test("loading, forbidden, error and unavailable states", () => {
    expect(render({ kind: "loading" })).toContain("Loading partner conversions…");
    expect(render({ kind: "forbidden" })).toContain("Ask an organization owner.");
    expect(render({ kind: "error" })).toContain("load partner conversions.");
    expect(render({ kind: "unavailable" })).toContain("not available yet");
  });

  test("an empty list says there are no conversions", () => {
    expect(render({ kind: "ready", data: [] })).toContain("No partner-reported conversions yet.");
  });

  test("each status is labelled in words, with its reported time and source", () => {
    const html = render({
      kind: "ready",
      data: [
        {
          id: "c_1",
          status: "reversed",
          reportedAt: "2026-11-01T09:30:00.000Z",
          source: "Partner feed",
          amount: { minor: 400n, currency: "USD", exponent: 2 },
        },
      ],
    });
    expect(html).toContain("Reversed");
    expect(html).toContain("2026-11-01 09:30 UTC");
    expect(html).toContain("Partner feed");
    expect(html).toContain("USD 4.00");
  });
});
