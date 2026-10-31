import { Button, Form, FormLabel, FormMessage, Input } from "@moneytrap/ui";
import type { FormEvent } from "react";
import { rateLimitMessage } from "./messages";

// UI-004. A privileged route sends the user here until a second factor is confirmed. A recovery code is an alternative.
export type StepUpStatus = "idle" | "submitting" | "invalid" | "rate-limited";
export type StepUpMode = "totp" | "recovery";

export function StepUpView({
  status,
  mode,
  wrongCount = 0,
  message,
  retryAfterSeconds = null,
  returnTo,
  onSubmit,
}: {
  status: StepUpStatus;
  mode: StepUpMode;
  returnTo?: string | undefined;
  wrongCount?: number;
  message?: string | undefined;
  retryAfterSeconds?: number | null;
  onSubmit?: (code: string) => void;
}) {
  const submitting = status === "submitting";
  const recovery = mode === "recovery";
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.(String(new FormData(event.currentTarget).get("code") ?? ""));
  };

  let error: string | undefined;
  if (status === "invalid") error = message;
  if (status === "rate-limited") error = rateLimitMessage(retryAfterSeconds);

  return (
    <section className="max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Confirm it&apos;s you</h1>
      <p className="text-sm">
        {recovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app."}
      </p>
      <Form aria-busy={submitting} onSubmit={handleSubmit}>
        <div className="space-y-1">
          <FormLabel htmlFor="step-up-code">{recovery ? "Recovery code" : "Code"}</FormLabel>
          {recovery ? (
            <Input id="step-up-code" name="code" autoComplete="one-time-code" required />
          ) : (
            <Input
              id="step-up-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
          )}
          {wrongCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {wrongCount === 1 ? "1 wrong code so far" : `${wrongCount} wrong codes so far`}
            </p>
          ) : null}
          <FormMessage>{error}</FormMessage>
        </div>
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={submitting}>
            Confirm
          </Button>
          <a href={switchHref(recovery ? "totp" : "recovery", returnTo)} className="text-sm">
            {recovery ? "Use an authenticator code" : "Use a recovery code"}
          </a>
        </div>
      </Form>
    </section>
  );
}

// The mode switch keeps the return destination. The pending sign-in lives in sessionStorage, so it needs no URL flag.
function switchHref(mode: StepUpMode, returnTo: string | undefined): string {
  const params = new URLSearchParams({ mode });
  if (returnTo) params.set("returnTo", returnTo);
  return `/step-up?${params.toString()}`;
}
