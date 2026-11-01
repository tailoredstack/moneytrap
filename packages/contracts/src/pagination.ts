import { type TSchema, Type } from "@sinclair/typebox";

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

// Opaque to clients: they echo it back and never parse it. Shape is `payload.signature`, both base64url.
// Signing and verifying live on the server (apps/server/src/http/cursor.ts), so this module stays browser-safe.
export const CursorSchema = Type.String({
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
