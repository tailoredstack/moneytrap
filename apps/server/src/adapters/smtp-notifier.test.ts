import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { NotificationMessage } from "@moneytrap/app";
import { runNotifierContract } from "@moneytrap/test-kit/src/contracts/notifier";
import { type MailTransport, SmtpNotifier } from "./smtp-notifier";

type Mail = Parameters<MailTransport["sendMail"]>[0];

function recordingTransport(): { transport: MailTransport; mails: Mail[] } {
  const mails: Mail[] = [];
  return {
    mails,
    transport: {
      async sendMail(mail) {
        mails.push(mail);
      },
    },
  };
}

const FROM = "Moneytrap <no-reply@moneytrap.test>";

// The contract sends these keys in this order; the SMTP mail itself carries no key.
const contractKeys = ["verify-email:usr_1:tok_1", "verify-email:usr_2:tok_2"];

runNotifierContract([
  {
    name: "SmtpNotifier",
    create: () => {
      const { transport, mails } = recordingTransport();
      return {
        notifier: new SmtpNotifier(transport, FROM),
        sent: () =>
          mails.map(
            (mail, index): NotificationMessage => ({
              // The mail carries no key, so the contract's keys are recovered by order.
              dedupKey: contractKeys[index] ?? "",
              to: mail.to,
              subject: mail.subject,
              body: mail.text,
            }),
          ),
      };
    },
  },
]);

const message: NotificationMessage = {
  dedupKey: "verify-email:usr_1:tok_1",
  to: "ada@example.com",
  subject: "Verify your Moneytrap email",
  body: "Confirm your email address: https://app.test/verify?token=SECRET-TOKEN",
};

describe("SmtpNotifier", () => {
  afterEach(() => {
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      (console[method] as unknown as { mockRestore?: () => void }).mockRestore?.();
    }
  });

  test("sends the message as plain text from the configured sender", async () => {
    const { transport, mails } = recordingTransport();
    await new SmtpNotifier(transport, FROM).send(message);
    expect(mails).toEqual([{ from: FROM, to: message.to, subject: message.subject, text: message.body }]);
  });

  test("a repeated dedup key sends one email, even when the repeats are concurrent", async () => {
    const { transport, mails } = recordingTransport();
    const notifier = new SmtpNotifier(transport, FROM);
    await Promise.all([notifier.send(message), notifier.send({ ...message, body: "other" }), notifier.send(message)]);
    await notifier.send(message);
    expect(mails).toHaveLength(1);
  });

  test("a failed send is rejected, then the same key can be delivered on retry", async () => {
    const mails: Mail[] = [];
    let failures = 1;
    const transport: MailTransport = {
      async sendMail(mail) {
        if (failures-- > 0) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNECTION" });
        mails.push(mail);
      },
    };
    const notifier = new SmtpNotifier(transport, FROM);
    await expect(notifier.send(message)).rejects.toThrow("SMTP delivery failed (ECONNECTION)");
    await notifier.send(message);
    await notifier.send(message);
    expect(mails).toHaveLength(1);
  });

  test("a failure does not carry the message body or URL", async () => {
    const transport: MailTransport = {
      async sendMail(mail) {
        throw Object.assign(new Error(`rejected: ${mail.text}`), { code: "EMESSAGE" });
      },
    };
    const error = await new SmtpNotifier(transport, FROM).send(message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain("SECRET-TOKEN");
    expect((error as Error).cause).toBeUndefined();
  });

  test("never logs the message, on success or failure", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => spyOn(console, method));
    const { transport } = recordingTransport();
    await new SmtpNotifier(transport, FROM).send(message);
    await new SmtpNotifier(
      {
        async sendMail() {
          throw new Error("down");
        },
      },
      FROM,
    )
      .send(message)
      .catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
