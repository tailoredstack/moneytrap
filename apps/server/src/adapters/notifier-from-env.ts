import type { Notifier } from "@moneytrap/app";
import { NotifyDev } from "./notify-dev";
import { createSmtpTransport, SmtpNotifier } from "./smtp-notifier";

const DEFAULT_SMTP_PORT = 1025;

// SMTP_HOST turns on SMTP delivery; without it the in-memory dev sink stays. SMTP_PORT defaults to Mailpit's 1025.
// SMTP_FROM has no default: a sender address is a deployment decision, so it is required once SMTP is on.
export function notifierFromEnv(env: Record<string, string | undefined>): Notifier {
  const host = env.SMTP_HOST?.trim();
  if (!host) return new NotifyDev();

  const from = env.SMTP_FROM?.trim();
  if (!from) throw new Error("SMTP_FROM is required when SMTP_HOST is set");

  const rawPort = env.SMTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_SMTP_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`SMTP_PORT must be a port number between 1 and 65535, got "${rawPort}"`);
  }

  return new SmtpNotifier(createSmtpTransport({ host, port }), from);
}
