import { assertDedupKey, type NotificationMessage, type Notifier } from "@moneytrap/app";

// In-memory stand-in for the dev sink. Records each notification once per dedup key.
export class FakeNotifier implements Notifier {
  private readonly seen = new Set<string>();
  private readonly sent_: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    assertDedupKey(message);
    if (this.seen.has(message.dedupKey)) return;
    this.seen.add(message.dedupKey);
    this.sent_.push({ ...message });
  }

  sent(): readonly NotificationMessage[] {
    return this.sent_.map((message) => ({ ...message }));
  }
}
