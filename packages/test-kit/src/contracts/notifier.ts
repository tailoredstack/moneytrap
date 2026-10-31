import { describe, expect, test } from "bun:test";
import type { NotificationMessage, Notifier } from "@moneytrap/app";

/** Shared contract for every Notifier: the in-memory fake and the dev sink must record the same way. */
export type NotifierFixture = {
  notifier: Notifier;
  sent(): readonly NotificationMessage[];
};

const verification: NotificationMessage = {
  dedupKey: "verify-email:usr_1:tok_1",
  to: "ada@example.com",
  subject: "Verify your email",
  body: "Open the link to verify.",
};

export function runNotifierContract(adapters: ReadonlyArray<{ name: string; create(): NotifierFixture }>): void {
  describe.each(adapters)("TP-W2-006 $name notifier contract", ({ create }) => {
    test("records a message with its fields", async () => {
      const { notifier, sent } = create();
      await notifier.send(verification);
      expect(sent()).toEqual([verification]);
    });

    test("a repeated dedup key records one notification", async () => {
      const { notifier, sent } = create();
      await notifier.send(verification);
      await notifier.send({ ...verification, body: "Retried body" });
      expect(sent()).toEqual([verification]);
    });

    test("distinct dedup keys each record a notification", async () => {
      const { notifier, sent } = create();
      await notifier.send(verification);
      await notifier.send({ ...verification, dedupKey: "verify-email:usr_2:tok_2", to: "grace@example.com" });
      expect(sent().map((message) => message.dedupKey)).toEqual([
        "verify-email:usr_1:tok_1",
        "verify-email:usr_2:tok_2",
      ]);
    });

    test("a blank dedup key is rejected and nothing is recorded", async () => {
      const { notifier, sent } = create();
      await expect(notifier.send({ ...verification, dedupKey: "   " })).rejects.toThrow("dedupKey is required");
      expect(sent()).toEqual([]);
    });
  });
}
