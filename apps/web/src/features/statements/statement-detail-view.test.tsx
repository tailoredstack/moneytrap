import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type StatementDetail, type StatementDetailState, StatementDetailView } from "./statement-detail-view";

const detail = (overrides: Partial<StatementDetail> = {}): StatementDetail => ({
  id: "s_1",
  periodStart: "2026-09-01T00:00:00.000Z",
  currency: "USD",
  exponent: 2,
  status: "closed",
  asOf: "2026-10-01T00:00:00.000Z",
  hash: "9f2c4b7e0a1d3c5f8e6b2a9d7c4f1e0b3a8d6c2f5e9b7a4d1c0e3f6a8b2d5c7e",
  lines: [
    {
      conversionId: "c_981",
      grossMinor: 1200n,
      platformMinor: 360n,
      publisherMinor: 840n,
      adjustmentMinor: -40n,
      receiptHref: "https://example.test/receipts/c_981",
    },
  ],
  nextCursor: null,
  ...overrides,
});

const render = (state: StatementDetailState, onNext?: (cursor: string) => void) =>
  renderToStaticMarkup(<StatementDetailView state={state} onNext={onNext} />);

// SKELETONS §6.2, UI-053, TP-W6-034: shows period, currency, as_of, and the hash of the closed statement.
describe("StatementDetailView (UI-053, TP-W6-034)", () => {
  test("loading, forbidden, error, not found and unavailable states", () => {
    expect(render({ kind: "loading" })).toContain("Loading statement…");
    expect(render({ kind: "forbidden" })).toContain("Ask an organization owner.");
    expect(render({ kind: "error" })).toContain("load statement.");
    const missing = render({ kind: "not_found" });
    expect(missing).toContain("Page not found.");
    expect(missing).not.toContain("Ask an organization owner.");
    expect(render({ kind: "unavailable" })).toContain("not available yet");
  });

  test("shows the period, closed status, currency, as-of time and full hash", () => {
    const html = render({ kind: "ready", data: detail() });
    expect(html).toContain("Statement Sep 2026 · Closed");
    expect(html).toContain("USD");
    expect(html).toContain("2026-10-01 00:00 UTC");
    expect(html).toContain("9f2c4b7e0a1d3c5f8e6b2a9d7c4f1e0b3a8d6c2f5e9b7a4d1c0e3f6a8b2d5c7e");
  });

  test("line items show gross, platform, publisher and adjustments with a receipt link", () => {
    const html = render({ kind: "ready", data: detail() });
    expect(html).toContain("c_981");
    expect(html).toContain("USD 12.00");
    expect(html).toContain("USD 3.60");
    expect(html).toContain("USD 8.40");
    expect(html).toContain("USD -0.40");
    expect(html).toContain('href="https://example.test/receipts/c_981"');
  });

  test("a next page appears only when there is a cursor and a handler", () => {
    expect(render({ kind: "ready", data: detail({ nextCursor: "n1" }) })).not.toContain("Next");
    const html = renderToStaticMarkup(
      <StatementDetailView state={{ kind: "ready", data: detail({ nextCursor: "n1" }) }} onNext={() => undefined} />,
    );
    expect(html).toContain("Next");
  });
});
