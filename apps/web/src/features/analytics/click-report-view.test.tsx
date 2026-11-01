import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClickReportState } from "./click-report";
import { ClickReportView } from "./click-report-view";

const ASOF = "2026-11-01T12:04:00.000Z";
const WINDOW = "Last 7 days";

const ready = (
  overrides: { rows?: { linkId: string; clicks: number }[]; stale?: boolean; nextCursor?: string | null } = {},
) =>
  ({
    kind: "ready",
    data: {
      rows: overrides.rows ?? [
        { linkId: "lnk_1", clicks: 1204 },
        { linkId: "lnk_2", clicks: 33 },
      ],
      asOf: ASOF,
      stale: overrides.stale ?? false,
      nextCursor: overrides.nextCursor ?? null,
    },
  }) satisfies ClickReportState;

const render = (state: ClickReportState, onNext?: (cursor: string) => void) =>
  renderToStaticMarkup(<ClickReportView state={state} windowLabel={WINDOW} onNext={onNext} />);

// SKELETONS §5.4 and §10.2. TP-W5-037 (stale), TP-W5-043 (table alternative, not colour-only).
describe("ClickReportView (UI-037, TP-W5-037, TP-W5-043)", () => {
  test("loading shows a status while the counts are read", () => {
    const html = render({ kind: "loading" });
    expect(html).toContain("Loading clicks…");
    expect(html).not.toContain("<table");
  });

  test("forbidden asks the owner, and a missing organization reads as page not found", () => {
    expect(render({ kind: "forbidden" })).toContain("Ask an organization owner.");
    const notFound = render({ kind: "not_found" });
    expect(notFound).toContain("Page not found.");
    expect(notFound).not.toContain("Ask an organization owner.");
  });

  test("an error shows the reference and no counts, never a zero", () => {
    const html = render({ kind: "error", ref: "req_9" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ref: req_9");
    expect(html).not.toContain("<table");
    expect(html).not.toMatch(/>0</);
  });

  test("populated shows a table with the counts and the freshness time", () => {
    const html = render(ready());
    expect(html).toContain("<caption");
    expect(html).toContain("lnk_1");
    expect(html).toContain("1,204");
    expect(html).toContain("Showing 2 links");
    expect(html).toContain("as of ");
    expect(html).toContain("2026-11-01 12:04 UTC");
  });

  test("stale data is labelled in words and its numbers stay visible", () => {
    const html = render(ready({ stale: true }));
    expect(html).toContain("Data stale · last update");
    expect(html).toContain("1,204");
    expect(html).not.toContain("as of ");
  });

  test("an empty window says so, and does not show a table of zeros", () => {
    const html = render(ready({ rows: [] }));
    expect(html).toContain("No clicks in this period yet.");
    expect(html).not.toContain("<table");
  });

  test("the bars are decoration; the count is the text", () => {
    const html = render(ready());
    expect(html).toContain('aria-hidden="true"');
  });

  test("Next appears only when the server has another page, and passes its cursor", () => {
    expect(render(ready())).not.toContain(">Next<");
    expect(render(ready({ nextCursor: "lnk_2" }), () => {})).toContain(">Next<");
  });
});
