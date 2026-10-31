import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { withRetryAfter } from "./retry-after-fetch";

// Every identity call goes through this client. It talks to /api/auth on the same origin, where the server mounts Better Auth.
// The plugins match the server's twoFactor and organization plugins, so their methods are typed here.
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), organizationClient()],
  fetchOptions: { customFetchImpl: withRetryAfter(fetch) },
});
