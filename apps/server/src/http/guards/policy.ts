import { can, type Permission, type Principal, type Scope } from "@moneytrap/domain";

// Loads the organization that owns the resource a route names. Returns null when the resource does not exist.
// It reads only route parameters, never client headers, so a caller cannot pick a scope.
export type ScopeResolver = (params: Readonly<Record<string, string>>) => Promise<Scope | null>;

// Every route declares exactly one of these. A route missing from the table is refused at runtime and fails the
// coverage test.
export type Guard =
  | { access: "public" }
  // Better Auth checks the caller and its own organization access-control statements (WP-2.9).
  | { access: "delegated"; reason: string }
  // Any signed-in user. The route limits its own data (for example, a user's own sessions).
  | { access: "session" }
  | { access: "permission"; permission: Permission; scope: ScopeResolver };

export type Denial = "UNAUTHENTICATED" | "FORBIDDEN" | "RESOURCE_NOT_FOUND";
export type Decision = { ok: true } | { ok: false; code: Denial };

const ALLOW: Decision = { ok: true };

// Pure apart from the resolver. Callers pass the principal already authenticated (or null for anonymous).
export async function decide(
  guard: Guard,
  principal: Principal | null,
  params: Readonly<Record<string, string>>,
): Promise<Decision> {
  if (guard.access === "public" || guard.access === "delegated") return ALLOW;
  if (!principal) return { ok: false, code: "UNAUTHENTICATED" };
  if (guard.access === "session") return ALLOW;

  const scope = await guard.scope(params);
  // Missing and foreign resources share one answer (CT-005). A foreign resource is one whose organization the
  // principal does not belong to, so the caller learns nothing about it, not even that it exists.
  if (!scope || !principal.memberships.some((m) => m.organizationId === scope.organizationId)) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }
  if (!can(principal, guard.permission, scope)) return { ok: false, code: "FORBIDDEN" };
  return ALLOW;
}
