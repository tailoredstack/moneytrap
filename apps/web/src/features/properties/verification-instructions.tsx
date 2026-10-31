import { Button } from "@moneytrap/ui";

export type CopyState = "idle" | "copied" | "failed";

// SKELETONS §2.3 "Verification instructions". The copy result is announced: success in a status region, failure in an alert.
export function VerificationInstructions({
  domain,
  challenge,
  expiresInHours,
  lastCheck,
  copyState,
  onCopy,
}: {
  domain: string;
  challenge: string;
  expiresInHours: number;
  lastCheck: string;
  copyState: CopyState;
  onCopy?: (() => void) | undefined;
}) {
  return (
    <section className="max-w-2xl space-y-3 text-sm">
      <p>Add this TXT record to {domain}:</p>
      <div className="flex items-center justify-between gap-2 rounded-md border p-3 font-mono">
        <code>{challenge}</code>
        <Button variant="outline" size="sm" aria-label="Copy the TXT record value" onClick={() => onCopy?.()}>
          Copy
        </Button>
      </div>
      {copyState === "copied" ? <p role="status">Copied to clipboard.</p> : null}
      {copyState === "failed" ? (
        <p role="alert" className="font-medium text-destructive">
          Could not copy. Select the value and copy it by hand.
        </p>
      ) : null}
      <p>Expires in {expiresInHours} h.</p>
      <p>Last check: {lastCheck}.</p>
    </section>
  );
}
