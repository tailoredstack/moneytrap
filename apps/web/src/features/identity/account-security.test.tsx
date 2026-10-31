import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountSecurityView } from "./account-security-view";

const setup = {
  totpURI: "otpauth://totp/Moneytrap:ana@example.com?secret=ABCDEFGH",
  backupCodes: ["aaaa-bbbb", "cccc-dddd"],
};

describe("AccountSecurityView (UI-006, UI-009, TP-W2-044)", () => {
  test("shows whether MFA is on and how many sessions are active", () => {
    const html = renderToStaticMarkup(<AccountSecurityView mfaEnabled sessionCount={3} />);
    expect(html).toContain("MFA: enabled");
    expect(html).toContain("Sessions: 3 active");
    expect(html).toContain("Manage sessions");
  });

  test("without setup in progress, shows no key or recovery codes", () => {
    const html = renderToStaticMarkup(<AccountSecurityView mfaEnabled={false} sessionCount={1} />);
    expect(html).not.toContain("aaaa-bbbb");
    expect(html).not.toContain("Recovery codes");
  });

  test("without MFA, asks for the password before setup starts", () => {
    const html = renderToStaticMarkup(<AccountSecurityView mfaEnabled={false} sessionCount={1} />);
    expect(html).toContain("Confirm your password to set up MFA.");
    expect(html).toContain('type="password"');
    expect(html).toContain("Set up MFA");
  });

  test("with MFA on, no setup prompt is shown", () => {
    const html = renderToStaticMarkup(<AccountSecurityView mfaEnabled sessionCount={1} />);
    expect(html).not.toContain("Set up MFA");
  });

  test("during setup, shows the key and recovery codes once with copy and download actions", () => {
    const html = renderToStaticMarkup(<AccountSecurityView mfaEnabled={false} sessionCount={1} setup={setup} />);
    expect(html).toContain("MFA setup (shown once)");
    expect(html).toContain("ABCDEFGH");
    expect(html).toContain("aaaa-bbbb");
    expect(html).toContain("cccc-dddd");
    expect(html).toContain("Copy all");
    expect(html).toContain("Download");
    expect(html).toContain("I saved my recovery codes");
  });

  test("the confirm button stays disabled until the saved-codes box is ticked", () => {
    const html = renderToStaticMarkup(
      <AccountSecurityView mfaEnabled={false} sessionCount={1} setup={setup} savedCodes={false} />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Confirm<\/button>/);
  });

  test("a failed confirm shows the error", () => {
    const html = renderToStaticMarkup(
      <AccountSecurityView
        mfaEnabled={false}
        sessionCount={1}
        setup={setup}
        savedCodes
        error="That code is not valid."
      />,
    );
    expect(html).toContain("That code is not valid.");
  });
});
