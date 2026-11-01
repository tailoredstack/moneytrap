import { authClient } from "../../api/auth-client";

// The same Better Auth session the identity screens read, here without the hook so a route can check it before rendering.
export type SessionReader = { getSession: () => Promise<{ data: unknown }> };

// A failed lookup counts as signed out. The visitor then sees the landing page instead of an error.
export async function isSignedIn(reader: SessionReader = authClient): Promise<boolean> {
  try {
    const { data } = await reader.getSession();
    return Boolean(data && typeof data === "object" && "session" in data && data.session);
  } catch {
    return false;
  }
}
