// Sends the two recovery-path emails Better Auth triggers. The server wires this to the Notifier port
// (WP-2.13) once it merges. Until then the composition root passes an implementation that holds
// messages in memory. Implementations must not log the URL, which carries a single-use token.
export interface AuthMailer {
  sendVerification(to: string, url: string): Promise<void>;
  sendPasswordReset(to: string, url: string): Promise<void>;
}
