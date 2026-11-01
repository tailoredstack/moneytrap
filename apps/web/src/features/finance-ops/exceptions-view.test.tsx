import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExceptionRow } from "./exceptions";
import { type ExceptionsState, ExceptionsView } from "./exceptions-view";

const many = (count: number): ExceptionRow[] =>
  Array.from({ length: count }, (_, index) => ({
    conversionId: `c_${String(index).padStart(3, "0")}`,
    reason: "no_click",
    status: "open",
    amount: { minor: 1200n, currency: "USD", exponent: 2 },
  }));

const render = (state: ExceptionsState) => renderToStaticMarkup(<ExceptionsView state={state} />);

// SKELETONS §6.3 and §10.2. TP-W6-033: paginated, filterable by reason, keyboard reachable (native controls).
describe("ExceptionsView (UI-040, TP-W6-033)", () => {
  test("loading, forbidden, error and unavailable states", () => {
    expect(render({ kind: "loading" })).toContain("Loading exceptions…");
    expect(render({ kind: "forbidden" })).toContain("Ask an organization owner.");
    expect(render({ kind: "error", ref: "req_3" })).toContain("Ref: req_3");
    expect(render({ kind: "unavailable" })).toContain("not available yet");
  });

  test("an empty queue says so and shows no table", () => {
    const html = render({ kind: "ready", data: [] });
    expect(html).toContain("No exceptions yet.");
    expect(html).not.toContain("<table");
  });

  test("labels the reason and status filters and shows one page of a long queue", () => {
    const html = render({ kind: "ready", data: many(300) });
    expect(html).toContain('for="exceptions-reason"');
    expect(html).toContain('for="exceptions-status"');
    expect(html).toContain("Showing 1–25 of 300");
    expect(html).toContain("c_000");
    expect(html).not.toContain("c_025");
    expect(html).toContain("No matching click");
    expect(html).toContain("USD 12.00");
  });

  test("shows the investigate action only when a handler is provided", () => {
    const withoutHandler = render({ kind: "ready", data: many(2) });
    expect(withoutHandler).not.toContain("Investigate");
    const withHandler = renderToStaticMarkup(
      <ExceptionsView state={{ kind: "ready", data: many(2) }} onInvestigate={() => undefined} />,
    );
    expect(withHandler).toContain("Investigate");
  });
});
