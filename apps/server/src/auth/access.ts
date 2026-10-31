import { PERMISSIONS, type Permission, ROLE_PERMISSIONS, ROLES, type Role } from "@moneytrap/domain";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

// Better Auth's organization endpoints check their own resources (member, invitation, organization). Each
// one takes the grant of the Moneytrap permission that does the same work, so both sides agree.
const BETTER_AUTH_GRANTS: ReadonlyArray<readonly [resource: string, action: string, permission: Permission]> = [
  ["organization", "update", "organization:update"],
  ["member", "create", "members:invite"],
  ["member", "update", "members:remove"],
  ["member", "delete", "members:remove"],
  ["invitation", "create", "members:invite"],
  ["invitation", "cancel", "members:invite"],
];

type Statements = Record<string, string[]>;

function addAction(into: Statements, resource: string, action: string) {
  into[resource] = [...new Set([...(into[resource] ?? []), action])];
}

// Every permission is `resource:action`, so the Better Auth statement is the same pair.
function splitPermission(permission: Permission): [resource: string, action: string] {
  const colon = permission.indexOf(":");
  return [permission.slice(0, colon), permission.slice(colon + 1)];
}

function statementsFor(permissions: readonly Permission[]): Statements {
  const out: Statements = {};
  for (const permission of permissions) {
    const [resource, action] = splitPermission(permission);
    addAction(out, resource, action);
  }
  for (const [resource, action, permission] of BETTER_AUTH_GRANTS) {
    if (permissions.includes(permission)) addAction(out, resource, action);
  }
  return out;
}

const statements: Statements = {};
for (const [resource, actions] of Object.entries(defaultStatements)) statements[resource] = [...actions];
for (const permission of PERMISSIONS) {
  const [resource, action] = splitPermission(permission);
  addAction(statements, resource, action);
}

// The organization plugin reads `ac` and `roles` from here. The grants come from ROLE_PERMISSIONS in
// @moneytrap/domain, so the map is written once.
export const accessControl = createAccessControl(statements);

export const roles = Object.fromEntries(
  ROLES.map((role: Role) => [role, accessControl.newRole(statementsFor(ROLE_PERMISSIONS[role]))]),
) as Record<Role, ReturnType<typeof accessControl.newRole>>;
