// Shared wording for a rate limit. The retry time is shown when the server sent one.
export function rateLimitMessage(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) return "Too many attempts. Try again later.";
  return `Too many attempts. Try again in ${retryAfterSeconds} seconds.`;
}
