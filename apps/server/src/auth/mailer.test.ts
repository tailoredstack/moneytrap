import { describe, expect, test } from "bun:test";
import { NotifyDev } from "../adapters/notify-dev";
import { notifierMailer } from "./mailer";

const verifyUrl = "https://moneytrap.test/api/auth/verify-email?token=SECRET-VERIFY-TOKEN";
const resetUrl = "https://moneytrap.test/api/auth/reset-password/SECRET-RESET-TOKEN?callbackURL=/";
const inviteUrl = "https://moneytrap.test/invitations/SECRET-INVITATION-ID";
const inviteExpiresAt = new Date("2026-11-02T10:00:00.000Z");

describe("notifierMailer", () => {
  test("sends the verification link through the Notifier to the user", async () => {
    const notifier = new NotifyDev();

    await notifierMailer(notifier).sendVerification("ada@example.test", verifyUrl);

    const [message] = notifier.messages();
    expect(message).toMatchObject({ to: "ada@example.test", subject: "Verify your Moneytrap email" });
    expect(message?.body).toContain(verifyUrl);
  });

  test("sends the reset link through the Notifier to the user", async () => {
    const notifier = new NotifyDev();

    await notifierMailer(notifier).sendPasswordReset("ada@example.test", resetUrl);

    const [message] = notifier.messages();
    expect(message).toMatchObject({ to: "ada@example.test", subject: "Reset your Moneytrap password" });
    expect(message?.body).toContain(resetUrl);
  });

  test("the dedup key never contains the single-use token", async () => {
    const notifier = new NotifyDev();

    await notifierMailer(notifier).sendVerification("ada@example.test", verifyUrl);
    await notifierMailer(notifier).sendPasswordReset("ada@example.test", resetUrl);

    for (const message of notifier.messages()) {
      expect(message.dedupKey).not.toContain("SECRET");
    }
  });

  test("resending the same link is recorded once; a new token is a new notification", async () => {
    const notifier = new NotifyDev();
    const mailer = notifierMailer(notifier);

    await mailer.sendVerification("ada@example.test", verifyUrl);
    await mailer.sendVerification("ada@example.test", verifyUrl);
    await mailer.sendVerification("ada@example.test", `${verifyUrl}&attempt=2`);

    expect(notifier.messages()).toHaveLength(2);
  });

  test("sends the invitation link through the Notifier with the expiry in the body", async () => {
    const notifier = new NotifyDev();

    await notifierMailer(notifier).sendInvitation("grace@example.test", inviteUrl, inviteExpiresAt);

    const [message] = notifier.messages();
    expect(message).toMatchObject({ to: "grace@example.test", subject: "You are invited to Moneytrap" });
    expect(message?.body).toContain(inviteUrl);
    expect(message?.body).toContain(inviteExpiresAt.toISOString());
  });

  test("the invitation dedup key never contains the invitation ID", async () => {
    const notifier = new NotifyDev();

    await notifierMailer(notifier).sendInvitation("grace@example.test", inviteUrl, inviteExpiresAt);

    expect(notifier.messages()[0]?.dedupKey).not.toContain("SECRET");
  });

  test("resending an invitation with a new expiry is a new notification; a repeat of the same send is not", async () => {
    const notifier = new NotifyDev();
    const mailer = notifierMailer(notifier);
    const extended = new Date("2026-11-05T10:00:00.000Z");

    await mailer.sendInvitation("grace@example.test", inviteUrl, inviteExpiresAt);
    await mailer.sendInvitation("grace@example.test", inviteUrl, inviteExpiresAt);
    await mailer.sendInvitation("grace@example.test", inviteUrl, extended);

    expect(notifier.messages()).toHaveLength(2);
  });
});
