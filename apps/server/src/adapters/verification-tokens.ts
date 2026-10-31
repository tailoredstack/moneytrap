import { createHash, randomBytes } from "node:crypto";
import type { VerificationTokens } from "@moneytrap/app/src/ports/verification-tokens";

// 32 random bytes encode to a 43-character URL-safe token, which fits in a TXT value unescaped.
export function createVerificationTokens(): VerificationTokens {
  return {
    issue: () => randomBytes(32).toString("base64url"),
    digest: (token) => createHash("sha256").update(token).digest("hex"),
  };
}
