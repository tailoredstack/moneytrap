import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type ProgramTermsData, ProgramTermsView } from "./program-terms-view";

const ASOF = "2026-10-31T12:04:00.000Z";

const terms: ProgramTermsData = {
  programName: "Acme Store",
  termsRevision: "rev-7",
  terms: "30-day cookie.",
  countries: ["US", "CA"],
  channels: ["Website"],
  decision: { decision: "deny", reasons: ["geography", "channel"] },
  approval: "approved",
  approvalRequested: false,
  asOf: ASOF,
  stale: false,
};

const ready = (overrides: Partial<ProgramTermsData> = {}) => ({
  kind: "ready" as const,
  data: { ...terms, ...overrides },
});

// SKELETONS §4.2, UI-029 and UI-030, TP-W4-028.
describe("ProgramTermsView (UI-029, UI-030, TP-W4-028)", () => {
  test("each denial reason is written out, so the text matches the decision", () => {
    const html = renderToStaticMarkup(<ProgramTermsView state={ready()} />);
    expect(html).toContain("The program does not allow your country");
    expect(html).toContain("The program does not allow this channel");
    expect(html).toContain("Not eligible: The program does not allow your country");
  });

  test("a denial with no reason says so, rather than showing an empty list", () => {
    const html = renderToStaticMarkup(
      <ProgramTermsView state={ready({ decision: { decision: "deny", reasons: [] } })} />,
    );
    expect(html).toContain("The network reported no reason for this decision.");
  });

  test("an allowed decision says every rule passes", () => {
    const html = renderToStaticMarkup(<ProgramTermsView state={ready({ decision: { decision: "allow" } })} />);
    expect(html).toContain("Every eligibility rule passes for this property.");
    expect(html).toContain(">Eligible<");
  });

  test("terms show their revision and the countries and channels the program allows", () => {
    const html = renderToStaticMarkup(<ProgramTermsView state={ready()} />);
    expect(html).toContain("Terms (revision rev-7)");
    expect(html).toContain("30-day cookie.");
    expect(html).toContain("US, CA");
    expect(html).toContain("Website");
  });

  test("request approval appears only when approval is still needed and the caller may ask", () => {
    const pending = renderToStaticMarkup(
      <ProgramTermsView state={ready({ approval: "not_reported" })} canRequestApproval onRequestApproval={() => {}} />,
    );
    expect(pending).toMatch(/<button[^>]*>Request approval<\/button>/);

    const approved = renderToStaticMarkup(
      <ProgramTermsView state={ready()} canRequestApproval onRequestApproval={() => {}} />,
    );
    expect(approved).not.toContain("Request approval");
  });

  test("once requested, the screen says the network decides, and offers no second request", () => {
    const html = renderToStaticMarkup(
      <ProgramTermsView
        state={ready({ approval: "pending", approvalRequested: true })}
        canRequestApproval
        onRequestApproval={() => {}}
      />,
    );
    expect(html).toContain("Only the network can approve");
    expect(html).not.toContain("Request approval");
  });

  test("an eligible program offers no approval request", () => {
    const html = renderToStaticMarkup(
      <ProgramTermsView
        state={ready({ decision: { decision: "allow" }, approval: "not_reported" })}
        canRequestApproval
        onRequestApproval={() => {}}
      />,
    );
    expect(html).not.toContain("Request approval");
  });

  test("a stale catalog keeps the terms visible and labelled", () => {
    const html = renderToStaticMarkup(<ProgramTermsView state={ready({ stale: true })} />);
    expect(html).toContain("Data stale");
    expect(html).toContain("30-day cookie.");
  });

  test("forbidden and error states replace the terms", () => {
    expect(renderToStaticMarkup(<ProgramTermsView state={{ kind: "forbidden" }} />)).toContain(
      "Ask an organization owner.",
    );
    expect(renderToStaticMarkup(<ProgramTermsView state={{ kind: "error" }} />)).toContain("load program terms.");
  });
});
