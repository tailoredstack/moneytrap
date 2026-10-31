import { createHash } from "node:crypto";
import type { Notifier } from "@moneytrap/app";

// Sends the two recovery-path emails Better Auth triggers. Implementations must not log the URL, which
// carries a single-use token.
export interface AuthMailer {
  sendVerification(to: string, url: string): Promise<void>;
  sendPasswordReset(to: string, url: string): Promise<void>;
}

// Adapts the Notifier port (WP-2.13) to the auth emails. The dedup key hashes the single-use URL, so each
// link is one logical notification and the token itself never becomes a stored key.
export function notifierMailer(notifier: Notifier): AuthMailer {
  return {
    async sendVerification(to, url) {
      await notifier.send({
        dedupKey: dedupKeyFor("verify-email", url),
        to,
        subject: "Verify your Moneytrap email",
        body: `Confirm your email address: ${url}`,
      });
    },
    async sendPasswordReset(to, url) {
      await notifier.send({
        dedupKey: dedupKeyFor("reset-password", url),
        to,
        subject: "Reset your Moneytrap password",
        body: `Reset your password: ${url}`,
      });
    },
  };
}

function dedupKeyFor(kind: string, url: string): string {
  return `${kind}:${createHash("sha256").update(url).digest("hex")}`;
}
