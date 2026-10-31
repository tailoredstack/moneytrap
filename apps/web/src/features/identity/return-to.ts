// Where to send the user after a sign-in or step-up. Only a path inside the app is allowed, so a crafted link cannot send the user off-site.
export function safeReturnTo(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/overview";
  return value;
}
