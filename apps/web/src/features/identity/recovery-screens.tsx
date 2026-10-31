import { Button, Form, FormLabel, FormMessage, Input } from "@moneytrap/ui";
import type { FormEvent } from "react";
import { rateLimitMessage } from "./messages";

// UI-007. The request reads the same whether or not the address has an account.
export type RecoveryRequestStatus = "idle" | "submitting" | "sent" | "rate-limited";

export function RecoveryRequestView({
  status,
  retryAfterSeconds = null,
  onSubmit,
}: {
  status: RecoveryRequestStatus;
  retryAfterSeconds?: number | null;
  onSubmit?: (email: string) => void;
}) {
  if (status === "sent") {
    return (
      <section className="max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p role="status">If an account exists, we sent a link.</p>
      </section>
    );
  }
  const submitting = status === "submitting";
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.(String(new FormData(event.currentTarget).get("email") ?? ""));
  };
  return (
    <section className="max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <Form aria-busy={submitting} onSubmit={handleSubmit}>
        <div className="space-y-1">
          <FormLabel htmlFor="recovery-email">Email</FormLabel>
          <Input id="recovery-email" name="email" type="email" autoComplete="email" required />
        </div>
        <FormMessage>{status === "rate-limited" ? rateLimitMessage(retryAfterSeconds) : undefined}</FormMessage>
        <Button type="submit" disabled={submitting || status === "rate-limited"}>
          Send reset link
        </Button>
      </Form>
    </section>
  );
}

// UI-008. A link is single use and expires. An expired or used link stops here and asks for a new one.
export type ResetStatus = "idle" | "submitting" | "mismatch" | "expired" | "rate-limited" | "failed" | "ok";

export function ResetPasswordView({
  status,
  retryAfterSeconds = null,
  onSubmit,
}: {
  status: ResetStatus;
  retryAfterSeconds?: number | null;
  onSubmit?: (input: { newPassword: string; confirmation: string }) => void;
}) {
  if (status === "expired") {
    return (
      <section className="max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        <FormMessage>This link has expired. Request a new one.</FormMessage>
        <a href="/forgot-password" className="text-sm">
          Request a new link
        </a>
      </section>
    );
  }
  if (status === "ok") {
    return (
      <section className="max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">Password updated</h1>
        <p role="status">You can log in with your new password.</p>
      </section>
    );
  }
  const submitting = status === "submitting";
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit?.({
      newPassword: String(data.get("newPassword") ?? ""),
      confirmation: String(data.get("confirmation") ?? ""),
    });
  };
  return (
    <section className="max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Set a new password</h1>
      <Form aria-busy={submitting} onSubmit={handleSubmit}>
        <div className="space-y-1">
          <FormLabel htmlFor="reset-password">New password</FormLabel>
          <Input
            id="reset-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </div>
        <div className="space-y-1">
          <FormLabel htmlFor="reset-confirmation">Confirm</FormLabel>
          <Input id="reset-confirmation" name="confirmation" type="password" autoComplete="new-password" required />
        </div>
        <FormMessage>{resetMessage(status, retryAfterSeconds)}</FormMessage>
        <Button type="submit" disabled={submitting}>
          Set password
        </Button>
      </Form>
    </section>
  );
}

function resetMessage(status: ResetStatus, retryAfterSeconds: number | null): string | undefined {
  if (status === "mismatch") return "The passwords do not match.";
  if (status === "rate-limited") return rateLimitMessage(retryAfterSeconds);
  if (status === "failed") return "Something went wrong. Try again.";
  return undefined;
}
