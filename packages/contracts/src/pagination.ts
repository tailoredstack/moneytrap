import { type TSchema, Type } from "@sinclair/typebox";

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

// Opaque to clients: they echo it back and never parse it.
const CursorSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[A-Za-z0-9_-]+$",
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

// The position is kept server-side as a JSON object; the wire form is base64url so clients cannot read or edit it.
export function encodeCursor(position: Record<string, string>): string {
  return Buffer.from(JSON.stringify(position)).toString("base64url");
}

export function decodeCursor(cursor: string): Record<string, string> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
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
