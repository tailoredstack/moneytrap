import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginView } from "./login-screen";
import { RecoveryRequestView, ResetPasswordView } from "./recovery-screens";
import { RegisterView } from "./register-screen";
import { StepUpView } from "./step-up-screen";

describe("RegisterView (UI-001, TP-W2-041, TP-W2-046)", () => {
  test("labels every field so the form works from the keyboard alone", () => {
    const html = renderToStaticMarkup(<RegisterView status="idle" />);
    expect(html).toContain('for="register-email"');
    expect(html).toContain('id="register-email"');
    expect(html).toContain('for="register-password"');
    expect(html).toContain("Requirements: 12+ characters");
  });

  test("a validation error is announced in a live region and the typed email is kept", () => {
    const html = renderToStaticMarkup(
      <RegisterView status="invalid" email="not-an-email" message="Enter a valid email." />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Enter a valid email.");
    expect(html).toContain('value="not-an-email"');
  });

  test("while submitting the button is disabled and the form reports busy", () => {
    const html = renderToStaticMarkup(<RegisterView status="submitting" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Create account<\/button>/);
  });

  test("an invalid field is marked and linked to its message", () => {
    const html = renderToStaticMarkup(<RegisterView status="invalid" email="x" message="Enter a valid email." />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="register-email-error"');
    expect(html).toContain('id="register-email-error"');
  });

  test("success says to check email, the same for known and unknown addresses", () => {
    const html = renderToStaticMarkup(<RegisterView status="sent" />);
    expect(html).toContain("Check your email");
    expect(html).not.toContain("already");
  });
});

describe("LoginView (UI-003, TP-W2-042)", () => {
  test("after a 429 the retry time is shown and no password is echoed", () => {
    const html = renderToStaticMarkup(
      <LoginView status="rate-limited" retryAfterSeconds={42} email="ana@example.com" />,
    );
    expect(html).toContain("Too many attempts. Try again in 42 seconds.");
    expect(html).toContain('value="ana@example.com"');
    expect(html).not.toContain('value="hunter2"');
  });

  test("after a rate limit the submit button stays enabled, so the user can retry once the wait is over", () => {
    const html = renderToStaticMarkup(<LoginView status="rate-limited" retryAfterSeconds={1} />);
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*type="submit"[^>]*>Log in<\/button>/);
  });

  test("a rate limit with no retry time says to wait before trying again", () => {
    const html = renderToStaticMarkup(<LoginView status="rate-limited" retryAfterSeconds={null} />);
    expect(html).toContain("Too many attempts. Try again later.");
  });

  test("a wrong password gives one generic message", () => {
    const html = renderToStaticMarkup(<LoginView status="failed" />);
    expect(html).toContain("Email or password is not right.");
  });

  test("offers forgot password next to the submit button", () => {
    const html = renderToStaticMarkup(<LoginView status="idle" />);
    expect(html).toContain("Forgot password?");
  });
});

describe("StepUpView (UI-004, TP-W2-043)", () => {
  test("asks for a six-digit code and offers a recovery code", () => {
    const html = renderToStaticMarkup(<StepUpView status="idle" mode="totp" />);
    expect(html).toContain("Confirm it&#x27;s you");
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain("Use a recovery code");
  });

  test("a wrong code shows how many have failed and never echoes the code", () => {
    const html = renderToStaticMarkup(
      <StepUpView status="invalid" mode="totp" wrongCount={2} message="That code is not valid." />,
    );
    expect(html).toContain("That code is not valid.");
    expect(html).toContain("2 wrong codes so far");
  });

  test("the mode switch keeps the return destination", () => {
    const html = renderToStaticMarkup(<StepUpView status="idle" mode="totp" returnTo="/account/security" />);
    expect(html).toContain("mode=recovery");
    expect(html).toContain("returnTo=%2Faccount%2Fsecurity");
  });

  test("a rate-limited challenge keeps the code button enabled for a retry", () => {
    const html = renderToStaticMarkup(<StepUpView status="rate-limited" mode="totp" retryAfterSeconds={30} />);
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*type="submit"[^>]*>Confirm<\/button>/);
  });

  test("a rate-limited challenge shows the retry time", () => {
    const html = renderToStaticMarkup(<StepUpView status="rate-limited" mode="totp" retryAfterSeconds={30} />);
    expect(html).toContain("Too many attempts. Try again in 30 seconds.");
  });
});

describe("recovery screens (UI-007, UI-008, TP-W2-023)", () => {
  test("the request confirmation is the same for every address", () => {
    const html = renderToStaticMarkup(<RecoveryRequestView status="sent" />);
    expect(html).toContain("If an account exists, we sent a link.");
  });

  test("a rate-limited request keeps the send button enabled for a retry", () => {
    const html = renderToStaticMarkup(<RecoveryRequestView status="rate-limited" retryAfterSeconds={60} />);
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*type="submit"[^>]*>Send reset link<\/button>/);
  });

  test("an expired or used link asks the user to request a new one", () => {
    const html = renderToStaticMarkup(<ResetPasswordView status="expired" />);
    expect(html).toContain("This link has expired. Request a new one.");
  });

  test("the reset form asks for the new password twice", () => {
    const html = renderToStaticMarkup(<ResetPasswordView status="idle" />);
    expect(html).toContain("New password");
    expect(html).toContain("Confirm");
    expect(html).toContain("Set password");
  });

  test("a mismatched confirmation is caught before anything is sent", () => {
    const html = renderToStaticMarkup(<ResetPasswordView status="mismatch" />);
    expect(html).toContain("The passwords do not match.");
  });
});
