import { runNotifierContract } from "../contracts/notifier";
import { FakeNotifier } from "./notifier";

runNotifierContract([
  {
    name: "FakeNotifier",
    create: () => {
      const notifier = new FakeNotifier();
      return { notifier, sent: () => notifier.sent() };
    },
  },
]);
