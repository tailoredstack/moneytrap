// Destination checks from spec §4.4 and blueprint §7. A link destination must be an https URL on a host the caller allows.
// The allow-list is an input, so this module stays pure: the caller decides which hosts a publisher may send traffic to.

export type DestinationProblem = "malformed" | "scheme" | "credentials" | "port" | "host-not-allowed";

export type DestinationResult =
  | { ok: true; value: { url: string; host: string } }
  | { ok: false; code: "VALIDATION_FAILED"; reason: DestinationProblem };

// Accepts only `https://<allowed host>/...` with no userinfo and no explicit port. javascript:, data:, and other schemes fail.
// The host must match an allow-list entry exactly, so subdomains and trailing-dot forms need their own entries.
export function validateDestination(input: string, allowedHosts: readonly string[]): DestinationResult {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "VALIDATION_FAILED", reason: "malformed" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "VALIDATION_FAILED", reason: "scheme" };
  // URL drops empty userinfo and default ports, so the authority is read from the raw input as well.
  const authority = /^https:\/\/([^/?#\\]*)/i.exec(raw)?.[1] ?? "";
  if (authority.includes("@")) return { ok: false, code: "VALIDATION_FAILED", reason: "credentials" };
  if (authority.includes(":")) return { ok: false, code: "VALIDATION_FAILED", reason: "port" };
  const host = url.hostname;
  const allowed = allowedHosts.some((entry) => hostOf(entry) === host);
  if (!allowed) return { ok: false, code: "VALIDATION_FAILED", reason: "host-not-allowed" };
  return { ok: true, value: { url: url.toString(), host } };
}

// Normalises an allow-list entry the way the URL parser normalises a host (case, IDN, trailing dot).
// An entry that is not a bare host, such as one with a path, userinfo, or port, matches nothing.
function hostOf(entry: string): string | null {
  const bare = entry.trim();
  if (!/^[^/@:?#\\\s]+$/.test(bare)) return null;
  try {
    return new URL(`https://${bare}`).hostname;
  } catch {
    return null;
  }
}
