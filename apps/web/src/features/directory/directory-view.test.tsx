import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type DirectoryRow, DirectoryView } from "./directory-view";

const ASOF = "2026-10-31T12:04:00.000Z";
const COUNTRIES = ["CA", "US"];

const rows: DirectoryRow[] = [
  { id: "prog_1", name: "Acme Store", countries: ["US", "CA"], decision: { decision: "allow" } },
  {
    id: "prog_2",
    name: "Foo Shoes",
    countries: ["US"],
    decision: { decision: "deny", reasons: ["geography"] },
  },
  { id: "prog_3", name: "Bar Travel", countries: [], decision: { decision: "deny", reasons: ["unknown"] } },
];

const ready = (data: { rows: DirectoryRow[]; stale?: boolean; hasMore?: boolean }) => ({
  kind: "ready" as const,
  data: { rows: data.rows, asOf: ASOF, stale: data.stale ?? false, hasMore: data.hasMore ?? false },
});

// SKELETONS §4.1, UI-028, TP-W4-027 and TP-W4-031.
describe("DirectoryView (UI-028, TP-W4-027, TP-W4-031)", () => {
  test("shows a loading state while the directory loads", () => {
    const html = renderToStaticMarkup(<DirectoryView state={{ kind: "loading" }} countries={COUNTRIES} />);
    expect(html).toContain("Loading programs…");
    expect(html).not.toContain("<table");
  });

  test("shows the forbidden copy, not the data, when the caller lacks access", () => {
    const html = renderToStaticMarkup(<DirectoryView state={{ kind: "forbidden" }} countries={COUNTRIES} />);
    expect(html).toContain("Ask an organization owner.");
    expect(html).not.toContain("<table");
  });

  test("an error shows a retry and the request reference", () => {
    const html = renderToStaticMarkup(
      <DirectoryView state={{ kind: "error", ref: "req_123" }} countries={COUNTRIES} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("load programs.");
    expect(html).toContain("Ref: req_123");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
  });

  test("with no programs and no filters, the empty state says so", () => {
    const html = renderToStaticMarkup(<DirectoryView state={ready({ rows: [] })} countries={COUNTRIES} />);
    expect(html).toContain("No programs yet.");
  });

  test("with filters that match nothing, the empty state gives a next step (TP-W4-027)", () => {
    const html = renderToStaticMarkup(
      <DirectoryView
        state={ready({ rows: [] })}
        countries={COUNTRIES}
        filters={{ q: "zzz", country: "", eligibleOnly: false }}
      />,
    );
    expect(html).toContain("No programs match. Try removing a filter.");
    expect(html).toMatch(/<button[^>]*>Clear filters<\/button>/);
  });

  test("the loaded count is a live status, so a change is announced", () => {
    const html = renderToStaticMarkup(<DirectoryView state={ready({ rows })} countries={COUNTRIES} />);
    expect(html).toMatch(/<p role="status"[^>]*>3 programs shown<\/p>/);
  });

  test("each row shows its status as text, and only eligible programs say Open", () => {
    const html = renderToStaticMarkup(<DirectoryView state={ready({ rows })} countries={COUNTRIES} />);
    expect(html).toContain("Eligible");
    expect(html).toContain("Not eligible: The program does not allow your country");
    expect(html).toContain("Unknown");
    expect(html).toMatch(/<button[^>]*aria-label="Open Acme Store"[^>]*>Open<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-label="Why\? Foo Shoes"[^>]*>Why\?<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-label="Why\? Bar Travel"[^>]*>Why\?<\/button>/);
  });

  test("a stale catalog keeps the numbers visible and says so in words", () => {
    const html = renderToStaticMarkup(<DirectoryView state={ready({ rows, stale: true })} countries={COUNTRIES} />);
    expect(html).toContain("Data stale");
    expect(html).toContain("Acme Store");
  });

  test("more results are offered as a button, so the list pages instead of loading everything", () => {
    const html = renderToStaticMarkup(<DirectoryView state={ready({ rows, hasMore: true })} countries={COUNTRIES} />);
    expect(html).toMatch(/<button[^>]*>Load more<\/button>/);
  });

  test("the last page has no load-more control", () => {
    const html = renderToStaticMarkup(<DirectoryView state={ready({ rows, hasMore: false })} countries={COUNTRIES} />);
    expect(html).not.toContain("Load more");
  });

  test("filters are labelled controls a keyboard user can reach", () => {
    const html = renderToStaticMarkup(<DirectoryView state={ready({ rows })} countries={COUNTRIES} />);
    expect(html).toContain('for="directory-search"');
    expect(html).toContain('for="directory-country"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Eligible only");
  });
});
