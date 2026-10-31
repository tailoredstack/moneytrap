// Destination checks from spec §4.4 and blueprint §7. A link destination must be an https URL on a host the caller allows.
// The allow-list is an input, so this module stays pure: the caller decides which hosts a publisher may send traffic to.

export type DestinationProblem = "malformed" | "scheme" | "credentials" | "port" | "host-not-allowed";

export type DestinationResult =
  | { ok: true; value: { url: string; host: string } }
  | { ok: false; code: "VALIDATION_FAILED"; reason: DestinationProblem };

// Accepts only `https://<allowed host>/...` with no userinfo and no explicit port. javascript:, data:, and other schemes fail.
// The host must match an allow-list entry exactly, so subdomains and trailing-dot forms need their own entries.
export function validateDestination(input: string, allowedHosts: readonly string[]): DestinationResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: "VALIDATION_FAILED", reason: "malformed" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "VALIDATION_FAILED", reason: "scheme" };
  if (url.username !== "" || url.password !== "")
    return { ok: false, code: "VALIDATION_FAILED", reason: "credentials" };
  if (url.port !== "") return { ok: false, code: "VALIDATION_FAILED", reason: "port" };
  const host = url.hostname;
  const allowed = allowedHosts.some((entry) => entry.trim().toLowerCase() === host);
  if (!allowed) return { ok: false, code: "VALIDATION_FAILED", reason: "host-not-allowed" };
  return { ok: true, value: { url: url.toString(), host } };
}
