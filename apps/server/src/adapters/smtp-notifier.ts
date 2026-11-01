import { assertDedupKey, type NotificationMessage, type Notifier } from "@moneytrap/app";
import { createTransport } from "nodemailer";

// The part of a nodemailer transport the adapter uses, so tests can stand in for the SMTP connection.
export type MailTransport = {
  sendMail(mail: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
};

export type SmtpConfig = { host: string; port: number; from: string };

// Plain SMTP with no auth, which is what a local capture server such as Mailpit accepts. The timeouts keep a sign-up
// from hanging when nothing is listening on the port.
export function createSmtpTransport({ host, port }: Pick<SmtpConfig, "host" | "port">): MailTransport {
  return createTransport({ host, port, connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000 });
}

// Delivers notifications over SMTP. Dedup matches NotifyDev: one send per key, and a repeated key is dropped. A key is
// held while its send is in flight, so two concurrent sends with one key deliver once. A failed send releases the key,
// so a retry can deliver. Nothing is logged: the body carries a single-use URL, and a failure is rethrown without it.
export class SmtpNotifier implements Notifier {
  private readonly claimed = new Map<string, Promise<void>>();

  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    assertDedupKey(message);
    const pending = this.claimed.get(message.dedupKey);
    if (pending) return pending;
    const delivery = this.deliver(message).catch((error: unknown) => {
      this.claimed.delete(message.dedupKey);
      throw error;
    });
    this.claimed.set(message.dedupKey, delivery);
    return delivery;
  }

  private async deliver(message: NotificationMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
    } catch (error) {
      // The original error is not chained: logging it must not be able to print the message.
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
      throw new Error(`SMTP delivery failed (${code})`);
    }
  }
}
