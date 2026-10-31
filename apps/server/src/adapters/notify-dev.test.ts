import { describe, expect, test } from "bun:test";
import type { NotificationMessage } from "@moneytrap/app";
import { runNotifierContract } from "@moneytrap/test-kit/src/contracts/notifier";
import { NotifyDev } from "./notify-dev";

runNotifierContract([
  {
    name: "NotifyDev",
    create: () => {
      const notifier = new NotifyDev();
      return { notifier, sent: () => notifier.messages() };
    },
  },
]);

describe("NotifyDev", () => {
  test("returns a copy of recorded messages so callers cannot mutate the sink", async () => {
    const notifier = new NotifyDev();
    await notifier.send({ dedupKey: "k1", to: "ada@example.com", subject: "s", body: "b" });
    (notifier.messages() as NotificationMessage[]).pop();
    expect(notifier.messages()).toHaveLength(1);
  });
});
