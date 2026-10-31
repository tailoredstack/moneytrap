// Where to send the user after a sign-in or step-up. Only a path inside the app is allowed, so a crafted link cannot send the user off-site.
export function safeReturnTo(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/overview";
  if (value === "/step-up" || value.startsWith("/step-up?")) return "/overview";
  return value;
}

// The step-up screen needs a sign-in that is waiting for a second factor. The login screen marks that hand-off with
// `challenge=1`. A direct visit lacks the mark, so it goes to login first and comes back to step-up after.
export function stepUpRedirect(input: { challenge: boolean; mode: "totp" | "recovery" }): string | null {
  if (input.challenge) return null;
  return `/login?returnTo=${encodeURIComponent(`/step-up?mode=${input.mode}`)}`;
}
