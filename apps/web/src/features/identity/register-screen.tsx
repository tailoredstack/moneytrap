import { Button, Form, FormLabel, FormMessage, Input } from "@moneytrap/ui";
import { type FormEvent, useEffect, useRef } from "react";

// UI-001. Validation errors are announced through FormMessage's live region. The typed email is kept on error.
export type RegisterStatus = "idle" | "submitting" | "invalid" | "sent";

export function RegisterView({
  status,
  email = "",
  message,
  onSubmit,
}: {
  status: RegisterStatus;
  email?: string;
  message?: string | undefined;
  onSubmit?: (input: { email: string; password: string }) => void;
}) {
  const emailRef = useRef<HTMLInputElement>(null);
  // SKELETONS §1.1: when validation fails, focus moves to the first error.
  useEffect(() => {
    if (status === "invalid") emailRef.current?.focus();
  }, [status]);
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
            aria-invalid={invalid}
            aria-describedby={invalid ? "register-email-error" : undefined}
          />
          <FormMessage id="register-email-error">{invalid ? message : undefined}</FormMessage>
        </div>
        <div className="space-y-1">
          <FormLabel htmlFor="register-password">Password</FormLabel>
          <Input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            aria-describedby="register-password-hint"
            required
          />
          <p id="register-password-hint" className="text-sm text-muted-foreground">
            Requirements: 12+ characters
          </p>
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
