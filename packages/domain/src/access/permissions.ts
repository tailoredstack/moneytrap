import type { Id } from "../ids/ids";

// Organization roles from DM-007. The role-to-permission map below is the only place grants are written.
// apps/server/src/auth/access.ts turns this map into Better Auth access-control roles, so Better Auth and
// `can()` read the same data.
export const ROLES = ["owner", "admin", "editor", "analyst", "finance", "viewer"] as const;
export type Role = (typeof ROLES)[number];

// Permission names are `resource:action`. Each one names the spec API catalog scope it serves in TP-W2-032.
export const PERMISSIONS = [
  "organization:read",
  "organization:update",
  "members:read",
  "members:invite",
  "members:remove",
  "publisher:submit",
  "publisher:status",
  "properties:read",
  "properties:write",
  "links:read",
  "links:write",
  "catalog:read",
  "catalog:write",
  "optimize:read",
  "optimize:write",
  "reports:read",
  "reports:write",
  "conversions:read",
  "balances:read",
  "payouts:read",
  "payouts:write",
  "api-keys:manage",
  "webhooks:manage",
  "preferences:update",
  "risk-appeals:read",
  "risk-appeals:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS;
const WRITER = [
  "organization:read",
  "members:read",
  "publisher:status",
  "properties:read",
  "properties:write",
  "links:read",
  "links:write",
  "catalog:read",
  "catalog:write",
  "optimize:read",
  "optimize:write",
  "reports:read",
  "conversions:read",
  "risk-appeals:read",
  "risk-appeals:write",
] as const satisfies readonly Permission[];

// The catalog has no scope that separates owner from admin, so both roles hold every permission. Owner-only
// operations are not split out yet; that needs a catalog change first.
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: ALL,
  admin: ALL,
  editor: WRITER,
  analyst: [
    "organization:read",
    "members:read",
    "publisher:status",
    "properties:read",
    "links:read",
    "catalog:read",
    "optimize:read",
    "reports:read",
    "reports:write",
    "conversions:read",
  ],
  finance: [
    "organization:read",
    "members:read",
    "publisher:status",
    "properties:read",
    "links:read",
    "catalog:read",
    "balances:read",
    "payouts:read",
    "payouts:write",
  ],
  viewer: [
    "organization:read",
    "members:read",
    "publisher:status",
    "properties:read",
    "links:read",
    "catalog:read",
    "reports:read",
    "conversions:read",
  ],
};

export interface Membership {
  readonly organizationId: Id<"organization">;
  readonly role: Role;
}

// The authenticated user and the organizations they belong to. Membership is the only source of a role.
export interface Principal {
  readonly userId: Id<"user">;
  readonly memberships: readonly Membership[];
}

// The organization a request targets. A client-selected ID can name a scope, but grants come only from membership.
export interface Scope {
  readonly organizationId: Id<"organization">;
}

// Pure: reads only its arguments. A principal's role in other organizations never counts, so a membership
// elsewhere cannot leak access across tenants (spec §4.1).
export function can(principal: Principal, permission: Permission, scope: Scope): boolean {
  const membership = principal.memberships.find((m) => m.organizationId === scope.organizationId);
  if (!membership) return false;
  return ROLE_PERMISSIONS[membership.role].includes(permission);
}
