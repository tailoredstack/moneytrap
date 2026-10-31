import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type NetworkStatusData, NetworkStatusView } from "./network-status-view";

const ASOF = "2026-10-31T12:04:00.000Z";

const data: NetworkStatusData = {
  networkName: "Example Network",
  health: "available",
  lastSuccessfulSync: "2026-10-31T09:04:00.000Z",
  asOf: ASOF,
  catalogStale: false,
  capabilities: { transactions: "supported", adjustments: "unsupported" },
  credential: { configured: true, lastRotated: "2026-08-02" },
};

const ready = (overrides: Partial<NetworkStatusData> = {}) => ({
  kind: "ready" as const,
  data: { ...data, ...overrides },
});

// SKELETONS §4.3, UI-026 and UI-076, TP-W4-003, TP-W4-029 and TP-W4-030.
describe("NetworkStatusView (UI-026, UI-076, TP-W4-029, TP-W4-030)", () => {
  test("loading, forbidden and error states replace the status panel", () => {
    expect(renderToStaticMarkup(<NetworkStatusView state={{ kind: "loading" }} />)).toContain("Loading network status");
    expect(renderToStaticMarkup(<NetworkStatusView state={{ kind: "forbidden" }} />)).toContain(
      "Ask an organization owner.",
    );
    const error = renderToStaticMarkup(<NetworkStatusView state={{ kind: "error", ref: "req_9" }} />);
    expect(error).toContain('role="alert"');
    expect(error).toContain("Ref: req_9");
  });

  test("a capability that is unsupported is reported as such, not as a blank", () => {
    const html = renderToStaticMarkup(<NetworkStatusView state={ready()} />);
    expect(html).toContain("Transactions:");
    expect(html).toContain("Supported");
    expect(html).toContain("Adjustments:");
    expect(html).toContain("Not offered by this network");
  });

  test("temporarily unavailable is a badge with an explanation, not an error (TP-W4-029)", () => {
    const html = renderToStaticMarkup(<NetworkStatusView state={ready({ health: "temporarily_unavailable" })} />);
    expect(html).toContain("Temporarily unavailable");
    expect(html).toContain("Sync retries automatically");
    expect(html).not.toContain('role="alert"');
  });

  test("stale catalog data is labelled and the last successful sync stays visible", () => {
    const html = renderToStaticMarkup(<NetworkStatusView state={ready({ catalogStale: true })} />);
    expect(html).toContain("Catalog data: stale");
    expect(html).toContain("Data stale");
    expect(html).toContain("2026-10-31T09:04:00.000Z");
  });

  test("the credential panel shows status and rotation date, never the credential value (TP-W4-030)", () => {
    const html = renderToStaticMarkup(<NetworkStatusView state={ready()} ops />);
    expect(html).toContain("✓ configured");
    expect(html).toContain("2026-08-02");
    expect(html).toMatch(/<button[^>]*>Retry sync<\/button>/);
  });

  test("publishers see neither the credential panel nor the retry control", () => {
    const html = renderToStaticMarkup(<NetworkStatusView state={ready()} />);
    expect(html).not.toContain("Credential:");
    expect(html).not.toContain("Retry sync");
  });
});
