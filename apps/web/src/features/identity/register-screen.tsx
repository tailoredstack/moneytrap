import { Button, Form, FormLabel, FormMessage, Input } from "@moneytrap/ui";
import { type FormEvent, useEffect, useRef } from "react";
import type { RegistrationField } from "./identity-actions";

// UI-001. Each error is announced under the field it belongs to. The typed email is kept on error.
export type RegisterStatus = "idle" | "submitting" | "invalid" | "sent";

export function RegisterView({
  status,
  email = "",
  invalidField,
  message,
  onSubmit,
}: {
  status: RegisterStatus;
  email?: string;
  invalidField?: RegistrationField | undefined;
  message?: string | undefined;
  onSubmit?: (input: { email: string; password: string }) => void;
}) {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // SKELETONS §1.1: when validation fails, focus moves to the first error, the field the outcome named.
  useEffect(() => {
    if (status !== "invalid") return;
    (invalidField === "password" ? passwordRef : emailRef).current?.focus();
  }, [status, invalidField]);
  if (status === "sent") {
    return (
      <section className="max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <p role="status">Check your email to finish creating your account.</p>
      </section>
    );
  }

  const submitting = status === "submitting";
  const invalid = status === "invalid";
  const emailInvalid = invalid && invalidField !== "password";
  const passwordInvalid = invalid && invalidField === "password";
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit?.({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
  };

  return (
    <section className="max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <Form aria-busy={submitting} onSubmit={handleSubmit}>
        <div className="space-y-1">
          <FormLabel htmlFor="register-email">Email</FormLabel>
          <Input
            ref={emailRef}
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={email}
            required
            aria-invalid={emailInvalid}
            aria-describedby={emailInvalid ? "register-email-error" : undefined}
          />
          <FormMessage id="register-email-error">{emailInvalid ? message : undefined}</FormMessage>
        </div>
        <div className="space-y-1">
          <FormLabel htmlFor="register-password">Password</FormLabel>
          <Input
            ref={passwordRef}
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            aria-invalid={passwordInvalid}
            aria-describedby={
              passwordInvalid ? "register-password-hint register-password-error" : "register-password-hint"
            }
            required
          />
          <p id="register-password-hint" className="text-sm text-muted-foreground">
            Requirements: 12+ characters
          </p>
          <FormMessage id="register-password-error">{passwordInvalid ? message : undefined}</FormMessage>
        </div>
        <Button type="submit" disabled={submitting}>
          Create account
        </Button>
      </Form>
      <p className="text-sm">
        Already have an account? <a href="/login">Log in</a>
      </p>
    </section>
  );
}
