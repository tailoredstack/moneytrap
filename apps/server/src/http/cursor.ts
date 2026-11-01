import { createHmac, timingSafeEqual } from "node:crypto";
import { CursorSchema } from "@moneytrap/contracts";

// Server-only: the HMAC key never leaves the server, so this module must not be imported by browser code.
function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

// The position is a JSON object. The HMAC key is supplied by the server, so a client cannot edit the position and keep a valid cursor.
export function encodeCursor(position: Record<string, string>, key: string): string {
  const payload = Buffer.from(JSON.stringify(position)).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export function decodeCursor(cursor: string, key: string): Record<string, string> | null {
  if (!CursorSchema.pattern || !new RegExp(CursorSchema.pattern).test(cursor)) return null;
  const [payload, signature] = cursor.split(".");
  if (payload === undefined || signature === undefined) return null;

  const expected = Buffer.from(sign(payload, key));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const isPosition =
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === "string");
    return isPosition ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}
