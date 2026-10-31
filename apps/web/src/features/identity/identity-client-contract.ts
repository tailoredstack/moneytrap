import { authClient } from "../../api/auth-client";
import type { IdentityClient } from "./identity-actions";

// Compile-time check only: the real Better Auth client must satisfy the slice the identity actions use.
export const client: IdentityClient = authClient;
