import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { validateKyb } from "./kyb-form";
import { KybFormView } from "./kyb-form-view";

// SKELETONS §2.2 "KYB form" (UI-015): required fields, inline errors, and the document held as a reference only.
describe("validateKyb (UI-015)", () => {
  test("requires a legal name, a country, and a business type", () => {
    expect(validateKyb({ legalName: "", country: "", businessType: null })).toEqual({
      legalName: "Enter the legal name.",
      country: "Choose a country.",
      businessType: "Choose a business type.",
    });
  });

  test("passes when every required field is set", () => {
    expect(validateKyb({ legalName: "Acme Media", country: "GB", businessType: "company" })).toEqual({});
  });
});

describe("KybFormView (UI-015)", () => {
  test("submit is marked unavailable until the required fields are valid, but stays focusable", () => {
    const html = renderToStaticMarkup(<KybFormView values={{ legalName: "", country: "", businessType: null }} />);
    expect(html).toMatch(/<button[^>]* aria-disabled="true"[^>]*>Submit for review<\/button>/);
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Submit for review<\/button>/);
  });

  test("an invalid submit shows the first error in a live region", () => {
    const html = renderToStaticMarkup(
      <KybFormView values={{ legalName: "", country: "GB", businessType: "company" }} submitAttempted />,
    );
    expect(html).toMatch(/role="alert"[\s\S]*Enter the legal name\./);
  });

  test("offers a labelled document upload control", () => {
    const html = renderToStaticMarkup(<KybFormView values={{ legalName: "", country: "", businessType: null }} />);
    expect(html).toMatch(/<label[^>]*>[\s\S]*Document[\s\S]*<input[^>]* type="file"[^>]*name="document"/);
  });

  test("says the document is kept as a reference only", () => {
    const html = renderToStaticMarkup(<KybFormView values={{ legalName: "", country: "", businessType: null }} />);
    expect(html).toContain("Stored securely; we keep a reference only.");
  });

  test("a submitting form disables its button", () => {
    const html = renderToStaticMarkup(
      <KybFormView values={{ legalName: "Acme Media", country: "GB", businessType: "company" }} submitting />,
    );
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Submitting…<\/button>/);
  });
});
