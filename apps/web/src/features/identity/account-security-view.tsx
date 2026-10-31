import { Button, Form, FormLabel, FormMessage, Input } from "@moneytrap/ui";
import { type FormEvent, useEffect, useRef } from "react";

// UI-006 and UI-009. The MFA setup block shows the key and recovery codes once. Nothing re-reads them from the server.
export type MfaSetup = { totpURI: string; backupCodes: string[] };

export function AccountSecurityView({
  mfaEnabled,
  sessionCount,
  setup,
  savedCodes = false,
  error,
  onSavedCodesChange,
  onConfirm,
  onStartSetup,
}: {
  mfaEnabled: boolean;
  sessionCount: number;
  setup?: MfaSetup | undefined;
  savedCodes?: boolean;
  error?: string | undefined;
  onSavedCodesChange?: (saved: boolean) => void;
  onConfirm?: (code: string) => void;
  onStartSetup?: (password: string) => void;
}) {
  const passwordRef = useRef<HTMLInputElement>(null);
  // A wrong password moves focus back to the password field, the only thing the user has to correct.
  useEffect(() => {
    if (!setup && error) passwordRef.current?.focus();
  }, [error, setup]);
  const handleConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConfirm?.(String(new FormData(event.currentTarget).get("code") ?? ""));
  };
  const handleStart = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onStartSetup?.(String(new FormData(event.currentTarget).get("password") ?? ""));
  };
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 rounded-md border p-4 text-sm">
        <h1 className="text-xl font-semibold">Account security</h1>
        <p>{mfaEnabled ? "MFA: enabled" : "MFA: not enabled"}</p>
        <p>{`Sessions: ${sessionCount} active`}</p>
        <a href="/account/sessions" className="text-sm underline">
          Manage sessions
        </a>
      </div>
      {!mfaEnabled && !setup ? (
        <Form onSubmit={handleStart} className="max-w-sm rounded-md border p-4">
          <p className="text-sm">Confirm your password to set up MFA.</p>
          <div className="space-y-1">
            <FormLabel htmlFor="mfa-password">Password</FormLabel>
            <Input
              ref={passwordRef}
              id="mfa-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={error !== undefined || undefined}
              aria-describedby={error !== undefined ? "mfa-password-error" : undefined}
            />
            <FormMessage id="mfa-password-error">{error}</FormMessage>
          </div>
          <Button type="submit">Set up MFA</Button>
        </Form>
      ) : null}
      {setup ? (
        <MfaSetupBlock
          setup={setup}
          savedCodes={savedCodes}
          error={error}
          onSavedCodesChange={onSavedCodesChange}
          onConfirm={handleConfirm}
        />
      ) : null}
    </section>
  );
}

function MfaSetupBlock({
  setup,
  savedCodes,
  error,
  onSavedCodesChange,
  onConfirm,
}: {
  setup: MfaSetup;
  savedCodes: boolean;
  error: string | undefined;
  onSavedCodesChange?: ((saved: boolean) => void) | undefined;
  onConfirm: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const secret = new URL(setup.totpURI).searchParams.get("secret") ?? "";
  const codeRef = useRef<HTMLInputElement>(null);
  // A wrong confirmation code moves focus to the code field.
  useEffect(() => {
    if (error) codeRef.current?.focus();
  }, [error]);
  const copyAll = () => void navigator.clipboard?.writeText(setup.backupCodes.join("\n"));
  const download = () => {
    const blob = new Blob([setup.backupCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement("a"), { href: url, download: "moneytrap-recovery-codes.txt" });
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4 rounded-md border p-4">
      <h2 className="font-semibold">MFA setup (shown once)</h2>
      <p className="text-sm">
        Add this key to your authenticator app, or open it directly.{" "}
        <a href={setup.totpURI} className="underline">
          Open in authenticator app
        </a>
      </p>
      <p className="font-mono text-sm">Or enter key: {secret}</p>
      <Form onSubmit={onConfirm}>
        <div className="space-y-1">
          <FormLabel htmlFor="mfa-code">Enter code</FormLabel>
          <Input
            ref={codeRef}
            id="mfa-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            aria-invalid={error !== undefined || undefined}
            aria-describedby={error !== undefined ? "mfa-code-error" : undefined}
          />
        </div>
        <FormMessage id="mfa-code-error">{error}</FormMessage>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recovery codes (shown once)</h3>
          <ol className="grid grid-cols-2 gap-1 font-mono text-sm">
            {setup.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ol>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copyAll}>
              Copy all
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={download}>
              Download
            </Button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="savedCodes"
            checked={savedCodes}
            onChange={(event) => onSavedCodesChange?.(event.currentTarget.checked)}
          />
          I saved my recovery codes
        </label>
        <Button type="submit" disabled={!savedCodes} aria-describedby={savedCodes ? undefined : "mfa-confirm-hint"}>
          Confirm
        </Button>
        {savedCodes ? null : (
          <p id="mfa-confirm-hint" className="text-sm text-muted-foreground">
            Tick &quot;I saved my recovery codes&quot; to enable Confirm.
          </p>
        )}
      </Form>
    </div>
  );
}
