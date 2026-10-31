// Maps an action outcome to the state a screen shows. A null result means the screen should leave (sign-in done, code accepted).
import type { CodeOutcome, RegisterOutcome, RegistrationField, ResetOutcome, SignInOutcome } from "./identity-actions";
import type { LoginStatus } from "./login-screen";
import { rateLimitMessage } from "./messages";
import type { ResetStatus } from "./recovery-screens";
import type { RegisterStatus } from "./register-screen";
import type { StepUpStatus } from "./step-up-screen";

const TRY_AGAIN = "Something went wrong. Try again.";

export function registerViewState(
  outcome: RegisterOutcome,
  email: string,
): { status: RegisterStatus; email: string; invalidField?: RegistrationField; message?: string } {
  switch (outcome.kind) {
    case "sent":
      return { status: "sent", email };
    case "invalid":
      return { status: "invalid", email, invalidField: outcome.field, message: outcome.message };
    case "rate-limited":
      return { status: "invalid", email, invalidField: "email", message: rateLimitMessage(outcome.retryAfterSeconds) };
    case "failed":
      return { status: "invalid", email, invalidField: "email", message: TRY_AGAIN };
  }
}

export function loginViewState(
  outcome: SignInOutcome,
): { status: LoginStatus; retryAfterSeconds: number | null } | null {
  switch (outcome.kind) {
    case "ok":
    case "two-factor":
      return null;
    case "rate-limited":
      return { status: "rate-limited", retryAfterSeconds: outcome.retryAfterSeconds };
    case "failed":
      return { status: "failed", retryAfterSeconds: null };
  }
}

export function stepUpViewState(
  outcome: CodeOutcome,
  wrongCount: number,
): { status: StepUpStatus; wrongCount: number; message?: string; retryAfterSeconds: number | null } | null {
  switch (outcome.kind) {
    case "ok":
    case "challenge-expired":
      return null;
    case "invalid":
      return { status: "invalid", message: outcome.message, wrongCount: wrongCount + 1, retryAfterSeconds: null };
    case "rate-limited":
      return { status: "rate-limited", wrongCount, retryAfterSeconds: outcome.retryAfterSeconds };
    case "failed":
      return { status: "invalid", message: TRY_AGAIN, wrongCount, retryAfterSeconds: null };
  }
}

export function resetViewState(outcome: ResetOutcome): { status: ResetStatus; retryAfterSeconds: number | null } {
  switch (outcome.kind) {
    case "ok":
      return { status: "ok", retryAfterSeconds: null };
    case "expired":
      return { status: "expired", retryAfterSeconds: null };
    case "rate-limited":
      return { status: "rate-limited", retryAfterSeconds: outcome.retryAfterSeconds };
    case "failed":
      return { status: "failed", retryAfterSeconds: null };
  }
}
