// Destination checks from spec §4.4 and blueprint §7. A link destination must be an https URL on a host the caller allows.
// The allow-list is an input, so this module stays pure: the caller decides which hosts a publisher may send traffic to.

export type DestinationProblem = "malformed" | "scheme" | "credentials" | "port" | "host-not-allowed";

export type DestinationResult =
  | { ok: true; value: { url: string; host: string } }
  | { ok: false; code: "VALIDATION_FAILED"; reason: DestinationProblem };

// Accepts only `https://<allowed host>/...` with no userinfo and no explicit port. javascript:, data:, and other schemes fail.
// The host must match an allow-list entry exactly, so subdomains and trailing-dot forms need their own entries.
export function validateDestination(input: string, allowedHosts: readonly string[]): DestinationResult {
  // URL silently strips tabs and newlines and drops leading control characters, which would hide the authority from the
  // raw-input checks below. Any control character is refused before parsing.
  if (hasControlCharacter(input)) return { ok: false, code: "VALIDATION_FAILED", reason: "malformed" };
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "VALIDATION_FAILED", reason: "malformed" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "VALIDATION_FAILED", reason: "scheme" };
  // URL drops empty userinfo and default ports, so the authority is read from the raw input as well.
  // The WHATWG parser takes `https:host` and `https:/host` as an authority too, so any run of slashes is skipped.
  const authority = /^https:[\\/]*([^/?#\\]*)/i.exec(raw)?.[1] ?? "";
  if (authority.includes("@")) return { ok: false, code: "VALIDATION_FAILED", reason: "credentials" };
  // An IP literal is never on the allow-list, so it is refused as a host, not as a port (its colons are not a port).
  if (authority.startsWith("[")) return { ok: false, code: "VALIDATION_FAILED", reason: "host-not-allowed" };
  if (authority.includes(":")) return { ok: false, code: "VALIDATION_FAILED", reason: "port" };
  const host = url.hostname;
  const allowed = allowedHosts.some((entry) => hostOf(entry) === host);
  if (!allowed) return { ok: false, code: "VALIDATION_FAILED", reason: "host-not-allowed" };
  return { ok: true, value: { url: url.toString(), host } };
}

// C0 controls and DEL. Checked by code point because a regex literal with these characters trips the linter.
function hasControlCharacter(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
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
