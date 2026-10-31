import { Button, Form, FormLabel, FormMessage, Input } from "@moneytrap/ui";
import type { FormEvent } from "react";
import { rateLimitMessage } from "./messages";

// UI-003. A wrong password and an unknown email read the same. The password is never written back into the page.
export type LoginStatus = "idle" | "submitting" | "rate-limited" | "failed";

export function LoginView({
  status,
  email = "",
  retryAfterSeconds = null,
  onSubmit,
}: {
  status: LoginStatus;
  email?: string;
  retryAfterSeconds?: number | null;
  onSubmit?: (input: { email: string; password: string }) => void;
}) {
  const submitting = status === "submitting";
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit?.({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
  };

  let message: string | undefined;
  if (status === "rate-limited") message = rateLimitMessage(retryAfterSeconds);
  if (status === "failed") message = "Email or password is not right.";

  return (
    <section className="max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Log in</h1>
      <Form aria-busy={submitting} onSubmit={handleSubmit}>
        <div className="space-y-1">
          <FormLabel htmlFor="login-email">Email</FormLabel>
          <Input id="login-email" name="email" type="email" autoComplete="email" defaultValue={email} required />
        </div>
        <div className="space-y-1">
          <FormLabel htmlFor="login-password">Password</FormLabel>
          <Input id="login-password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <FormMessage>{message}</FormMessage>
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={submitting || status === "rate-limited"}>
            Log in
          </Button>
          <a href="/forgot-password" className="text-sm">
            Forgot password?
          </a>
        </div>
      </Form>
    </section>
  );
}
