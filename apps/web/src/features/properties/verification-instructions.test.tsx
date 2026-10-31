import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VerificationInstructions } from "./verification-instructions";

const props = {
  domain: "news.example.com",
  challenge: "moneytrap-verify=ab12cd34",
  expiresInHours: 23,
  lastCheck: "no record found (retry in 60 s)",
};

// TP-W3-029 and SKELETONS §2.3 "Verification instructions": the copy button copies the challenge and the result is announced.
describe("VerificationInstructions (TP-W3-029, UI-020)", () => {
  test("shows the TXT record to add and when the challenge expires", () => {
    const html = renderToStaticMarkup(<VerificationInstructions {...props} copyState="idle" />);
    expect(html).toContain("Add this TXT record to news.example.com");
    expect(html).toContain("moneytrap-verify=ab12cd34");
    expect(html).toContain("Expires in 23 h.");
  });

  test("the copy button names the value it copies", () => {
    const html = renderToStaticMarkup(<VerificationInstructions {...props} copyState="idle" />);
    expect(html).toContain('aria-label="Copy the TXT record value"');
  });

  test("a successful copy is announced in a live region", () => {
    const html = renderToStaticMarkup(<VerificationInstructions {...props} copyState="copied" />);
    expect(html).toMatch(/role="status"[^>]*>Copied to clipboard\./);
  });

  test("a failed copy tells the user to select the value by hand", () => {
    const html = renderToStaticMarkup(<VerificationInstructions {...props} copyState="failed" />);
    expect(html).toMatch(/role="alert"[^>]*>Could not copy\. Select the value and copy it by hand\./);
  });

  test("the last check result is shown as text", () => {
    const html = renderToStaticMarkup(<VerificationInstructions {...props} copyState="idle" />);
    expect(html).toContain("Last check: no record found (retry in 60 s).");
  });
});
