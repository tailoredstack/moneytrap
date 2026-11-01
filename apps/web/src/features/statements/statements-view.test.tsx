import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { StatementRow } from "./statements";
import { type StatementsState, StatementsView } from "./statements-view";

const rows: StatementRow[] = [
  {
    id: "s_1",
    periodStart: "2026-09-01T00:00:00.000Z",
    currency: "USD",
    status: "closed",
    total: { minor: 120410n, currency: "USD", exponent: 2 },
  },
];

const render = (
  state: StatementsState,
  handlers: { onView?: (id: string) => void; onDownload?: (id: string) => void } = {},
) => renderToStaticMarkup(<StatementsView state={state} {...handlers} />);

// SKELETONS §6.2 and §10.2. UI-043 states, and the period and currency filters.
describe("StatementsView (UI-043)", () => {
  test("loading, forbidden, error and unavailable states", () => {
    expect(render({ kind: "loading" })).toContain("Loading statements…");
    expect(render({ kind: "forbidden" })).toContain("Ask an organization owner.");
    expect(render({ kind: "error", ref: "req_5" })).toContain("Ref: req_5");
    expect(render({ kind: "unavailable" })).toContain("not available yet");
  });

  test("an empty list says there are no statements", () => {
    expect(render({ kind: "ready", data: [] })).toContain("No statements yet.");
  });

  test("ready shows the period, total with currency, closed status, and labelled filters", () => {
    const html = render({ kind: "ready", data: rows });
    expect(html).toContain("Sep 2026");
    expect(html).toContain("USD 1,204.10");
    expect(html).toContain("Closed");
    expect(html).toContain('for="statements-period"');
    expect(html).toContain('for="statements-currency"');
  });

  test("view and download actions appear only when a handler is given", () => {
    const bare = render({ kind: "ready", data: rows });
    expect(bare).not.toContain("View");
    expect(bare).not.toContain("Download");
    const actions = render({ kind: "ready", data: rows }, { onView: () => undefined, onDownload: () => undefined });
    expect(actions).toContain("View");
    expect(actions).toContain("Download");
  });
});
