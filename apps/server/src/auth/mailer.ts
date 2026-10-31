import { createHash } from "node:crypto";
import type { Notifier } from "@moneytrap/app";

// Sends the emails Better Auth triggers: the two recovery-path emails and organization invitations. Implementations
// must not log the URL, which carries a single-use token.
export interface AuthMailer {
  sendVerification(to: string, url: string): Promise<void>;
  sendPasswordReset(to: string, url: string): Promise<void>;
  sendInvitation(to: string, url: string, expiresAt: Date): Promise<void>;
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
    // The expiry is part of the key: a resend extends the invitation, so it is a new notification, while a repeat of
    // the same send is recorded once.
    async sendInvitation(to, url, expiresAt) {
      await notifier.send({
        dedupKey: dedupKeyFor("invitation", `${url}|${expiresAt.toISOString()}`),
        to,
        subject: "You are invited to Moneytrap",
        body: `You have been invited to join an organization on Moneytrap. Accept by ${expiresAt.toISOString()}: ${url}`,
      });
    },
  };
}

function dedupKeyFor(kind: string, url: string): string {
  return `${kind}:${createHash("sha256").update(url).digest("hex")}`;
}
