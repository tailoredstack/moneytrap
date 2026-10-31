// Outbound notifications (Blueprint §5.2, spec §6.3). Every message carries a dedup key: adapters record a
// notification once per key, so a retried action or a redelivered event cannot send the same email twice.
// The key names the logical notification (for example "verify-email:<user id>:<token id>"), not the attempt.

export type NotificationMessage = {
  dedupKey: string;
  to: string;
  subject: string;
  body: string;
};

export interface Notifier {
  send(message: NotificationMessage): Promise<void>;
}

// Shared by every adapter and fake so a blank key fails the same way everywhere.
export function assertDedupKey(message: NotificationMessage): void {
  if (typeof message.dedupKey !== "string" || message.dedupKey.trim() === "") {
    throw new RangeError("dedupKey is required");
  }
}
