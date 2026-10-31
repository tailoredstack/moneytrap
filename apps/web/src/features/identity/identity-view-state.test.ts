import { describe, expect, test } from "bun:test";
import { loginViewState, registerViewState, resetViewState, stepUpViewState } from "./identity-view-state";

describe("registerViewState", () => {
  test("a sent outcome shows check-your-email and keeps the address", () => {
    expect(registerViewState({ kind: "sent" }, "ana@example.com")).toEqual({
      status: "sent",
      email: "ana@example.com",
    });
  });

  test("a validation message is shown inline with the address kept", () => {
    expect(registerViewState({ kind: "invalid", field: "email", message: "Enter a valid email." }, "bad")).toEqual({
      status: "invalid",
      email: "bad",
      invalidField: "email",
      message: "Enter a valid email.",
    });
  });

  test("a rate limit is shown as the retry message", () => {
    expect(registerViewState({ kind: "rate-limited", retryAfterSeconds: 9 }, "ana@example.com")).toEqual({
      status: "invalid",
      email: "ana@example.com",
      invalidField: "email",
      message: "Too many attempts. Try again in 9 seconds.",
    });
  });

  test("a failure asks to try again", () => {
    expect(registerViewState({ kind: "failed" }, "ana@example.com")).toEqual({
      status: "invalid",
      email: "ana@example.com",
      invalidField: "email",
      message: "Something went wrong. Try again.",
    });
  });
});

describe("loginViewState", () => {
  test("a successful sign-in or a second-factor challenge leaves the screen", () => {
    expect(loginViewState({ kind: "ok" })).toBeNull();
    expect(loginViewState({ kind: "two-factor" })).toBeNull();
  });

  test("a rate limit keeps the retry time", () => {
    expect(loginViewState({ kind: "rate-limited", retryAfterSeconds: 42 })).toEqual({
      status: "rate-limited",
      retryAfterSeconds: 42,
    });
  });

  test("a wrong password is the generic failure", () => {
    expect(loginViewState({ kind: "failed" })).toEqual({ status: "failed", retryAfterSeconds: null });
  });
});

describe("stepUpViewState", () => {
  test("a valid code leaves the screen", () => {
    expect(stepUpViewState({ kind: "ok" }, 0)).toBeNull();
  });

  test("a wrong code increments the visible count and never carries the code", () => {
    expect(stepUpViewState({ kind: "invalid", message: "That code is not valid." }, 1)).toEqual({
      status: "invalid",
      message: "That code is not valid.",
      wrongCount: 2,
      retryAfterSeconds: null,
    });
  });

  test("an expired challenge leaves the screen so the caller can send the user to sign in", () => {
    expect(stepUpViewState({ kind: "challenge-expired" }, 0)).toBeNull();
  });

  test("a rate limit keeps the retry time", () => {
    expect(stepUpViewState({ kind: "rate-limited", retryAfterSeconds: 30 }, 2)).toEqual({
      status: "rate-limited",
      wrongCount: 2,
      retryAfterSeconds: 30,
    });
  });
});

describe("resetViewState", () => {
  test("a valid link sets the password", () => {
    expect(resetViewState({ kind: "ok" })).toEqual({ status: "ok", retryAfterSeconds: null });
  });

  test("an expired link asks for a new one", () => {
    expect(resetViewState({ kind: "expired" })).toEqual({ status: "expired", retryAfterSeconds: null });
  });

  test("a rate limit keeps the retry time", () => {
    expect(resetViewState({ kind: "rate-limited", retryAfterSeconds: 5 })).toEqual({
      status: "rate-limited",
      retryAfterSeconds: 5,
    });
  });

  test("a failure reads as a generic error", () => {
    expect(resetViewState({ kind: "failed" })).toEqual({ status: "failed", retryAfterSeconds: null });
  });
});
