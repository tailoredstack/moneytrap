import { createHmac, timingSafeEqual } from "node:crypto";
import { type TSchema, Type } from "@sinclair/typebox";

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

// Opaque to clients: they echo it back and never parse it. Shape is `payload.signature`, both base64url.
const CursorSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$",
  description: "Opaque continuation token",
});

export const PageParamsSchema = Type.Object({
  cursor: Type.Optional(CursorSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: PAGE_SIZE_MAX, default: PAGE_SIZE_DEFAULT })),
});

export function pageSchema<T extends TSchema>(item: T) {
  return Type.Object({
    data: Type.Array(item),
    meta: Type.Object({ next_cursor: Type.Union([CursorSchema, Type.Null()]) }),
  });
}

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
