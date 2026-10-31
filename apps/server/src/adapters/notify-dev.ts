import { assertDedupKey, type NotificationMessage, type Notifier } from "@moneytrap/app";

// Dev sink for notifications. Nothing leaves the process; messages are kept so tests and local runs can read
// them. Dedup works like the fake: the first message with a key is recorded, later ones are dropped.
export class NotifyDev implements Notifier {
  private readonly seen = new Set<string>();
  private readonly recorded: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    assertDedupKey(message);
    if (this.seen.has(message.dedupKey)) return;
    this.seen.add(message.dedupKey);
    this.recorded.push({ ...message });
  }

  messages(): readonly NotificationMessage[] {
    return this.recorded.map((message) => ({ ...message }));
  }
}
