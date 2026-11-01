import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type ImportBatch, type ImportsState, ImportsView } from "./imports-view";

const imported: ImportBatch = {
  id: "b_12",
  startedAt: "2026-11-01T10:00:00.000Z",
  status: "imported",
  rowCount: 1204,
  errorCount: 0,
  matchedCount: 1190,
  unmatchedCount: 14,
  failureReason: null,
  digest: "9f2c7a1e",
  parserVersion: "3",
};

const failed: ImportBatch = {
  id: "b_13",
  startedAt: "2026-11-01T11:00:00.000Z",
  status: "failed",
  rowCount: 0,
  errorCount: 0,
  matchedCount: null,
  unmatchedCount: null,
  failureReason: "timeout",
  digest: "4b1d0c2e",
  parserVersion: "3",
};

const render = (state: ImportsState, onRetry?: (id: string) => void) =>
  renderToStaticMarkup(<ImportsView state={state} onRetry={onRetry} />);

// SKELETONS §6.4, UI-039, TP-W6-036: a failed batch shows its reason and a retry path.
describe("ImportsView (UI-039, TP-W6-036)", () => {
  test("loading, forbidden, error and unavailable states", () => {
    expect(render({ kind: "loading" })).toContain("Loading imports…");
    expect(render({ kind: "forbidden" })).toContain("Ask an organization owner.");
    expect(render({ kind: "error" })).toContain("load imports.");
    expect(render({ kind: "unavailable" })).toContain("not available yet");
  });

  test("an empty list says there are no imports", () => {
    expect(render({ kind: "ready", data: [] })).toContain("No imports yet.");
  });

  test("an imported batch shows its row, error and matching counts with the digest and parser version", () => {
    const html = render({ kind: "ready", data: [imported] });
    expect(html).toContain("Imported");
    expect(html).toContain("1,204 rows · 0 errors");
    expect(html).toContain("1,190 matched · 14 unmatched");
    expect(html).toContain("9f2c7a1e");
    expect(html).toContain("parser 3");
  });

  test("a failed batch shows its reason in words and a retry action when a handler is given", () => {
    const html = render({ kind: "ready", data: [failed] }, () => undefined);
    expect(html).toContain("Failed");
    expect(html).toContain("timeout");
    expect(html).toContain("Retry");
    expect(render({ kind: "ready", data: [failed] })).not.toContain("Retry");
  });
});
