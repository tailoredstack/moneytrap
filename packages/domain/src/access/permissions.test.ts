import { describe, expect, test } from "bun:test";
import { type Id, parseId } from "../ids/ids";
import { can, PERMISSIONS, type Permission, ROLES, type Role } from "./permissions";

const orgA = parseId("organization", "org_00000000000000000000000000") as Id<"organization">;
const orgB = parseId("organization", "org_00000000000000000000000001") as Id<"organization">;
const userId = parseId("user", "usr_00000000000000000000000000") as Id<"user">;

const ALL = ROLES;
const ADMIN = ["owner", "admin"] as const;
const WRITERS = ["owner", "admin", "editor"] as const;

// TP-W2-032: the role × action matrix. Each row is one permission, the spec API catalog operations that
// use it (their `caller/security scope` is noted), and the roles allowed to call them. A role's grant follows
// the catalog scope: session:member → every role; session:owner → owner and admin; session:editor → owner,
// admin, editor; session:analyst → owner, admin, editor, analyst; a payouts or balances scope → owner, admin,
// finance; session:publisher → owner, admin, editor.
const MATRIX: ReadonlyArray<{ permission: Permission; apis: string; roles: readonly Role[] }> = [
  { permission: "organization:read", apis: "API-016 (session:member)", roles: ALL },
  { permission: "organization:update", apis: "API-017 (session:owner)", roles: ADMIN },
  { permission: "members:read", apis: "API-018 (session:member)", roles: ALL },
  { permission: "members:invite", apis: "API-019 (session:owner)", roles: ADMIN },
  { permission: "members:remove", apis: "API-021 (session:owner)", roles: ADMIN },
  { permission: "publisher:submit", apis: "API-022 (session:owner)", roles: ADMIN },
  { permission: "publisher:status", apis: "API-023 (session:member)", roles: ALL },
  // No tenant role holds the grant: owners and admins submit KYB and must not approve their own publishers (UC06).
  { permission: "publisher:review", apis: "API-069, API-070 (admin:reviewer)", roles: [] },
  { permission: "properties:read", apis: "API-025, API-026 (properties:read)", roles: ALL },
  { permission: "properties:write", apis: "API-024, API-027–031 (properties:write)", roles: WRITERS },
  { permission: "links:read", apis: "API-037, API-038, API-042 (links:read)", roles: ALL },
  { permission: "links:write", apis: "API-036, API-039–041 (links:write)", roles: WRITERS },
  { permission: "catalog:read", apis: "API-032–034 (catalog:read)", roles: ALL },
  { permission: "catalog:write", apis: "API-035 (catalog:write)", roles: WRITERS },
  { permission: "optimize:read", apis: "API-096 (session:analyst)", roles: ["owner", "admin", "editor", "analyst"] },
  { permission: "optimize:write", apis: "API-091–095, API-110 (session:editor)", roles: WRITERS },
  {
    permission: "reports:read",
    apis: "API-045–047, API-049 (reports:read)",
    roles: ["owner", "admin", "editor", "analyst", "viewer"],
  },
  { permission: "reports:write", apis: "API-048 (reports:write)", roles: ["owner", "admin", "analyst"] },
  {
    permission: "conversions:read",
    apis: "API-050 (conversions:read)",
    roles: ["owner", "admin", "editor", "analyst", "viewer"],
  },
  { permission: "balances:read", apis: "API-051–053 (balances:read)", roles: ["owner", "admin", "finance"] },
  { permission: "payouts:read", apis: "API-054, API-057 (payouts:read)", roles: ["owner", "admin", "finance"] },
  {
    permission: "payouts:write",
    apis: "API-055, API-056, API-058 (payouts:write)",
    roles: ["owner", "admin", "finance"],
  },
  { permission: "api-keys:manage", apis: "API-059–062 (session:owner)", roles: ADMIN },
  { permission: "webhooks:manage", apis: "API-063–068 (session:owner)", roles: ADMIN },
  { permission: "preferences:update", apis: "API-109 (session:owner)", roles: ADMIN },
  { permission: "risk-appeals:read", apis: "API-101 (session:publisher)", roles: WRITERS },
  { permission: "risk-appeals:write", apis: "API-100 (session:publisher)", roles: WRITERS },
];

function principalIn(organizationId: Id<"organization">, role: Role) {
  return { userId, memberships: [{ organizationId, role }] };
}

describe("TP-W2-032 role × action matrix (spec API catalog)", () => {
  test("the matrix covers every permission exactly once", () => {
    const listed = MATRIX.map((row) => row.permission).sort();
    expect(listed).toEqual([...PERMISSIONS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  for (const row of MATRIX) {
    test(`${row.permission} is granted to exactly ${row.roles.join(", ")} (${row.apis})`, () => {
      const granted = ROLES.map((role) => can(principalIn(orgA, role), row.permission, { organizationId: orgA }));
      expect(granted).toEqual(ROLES.map((role) => row.roles.includes(role)));
    });
  }
});

describe("can(principal, permission, scope)", () => {
  test("a principal with no membership in the scope's organization is denied", () => {
    expect(can(principalIn(orgB, "owner"), "organization:read", { organizationId: orgA })).toBe(false);
  });

  test("a principal with no memberships is denied", () => {
    expect(can({ userId, memberships: [] }, "organization:read", { organizationId: orgA })).toBe(false);
  });

  test("the role in one organization grants nothing in another", () => {
    const principal = {
      userId,
      memberships: [
        { organizationId: orgA, role: "owner" as const },
        { organizationId: orgB, role: "viewer" as const },
      ],
    };
    expect(can(principal, "members:invite", { organizationId: orgB })).toBe(false);
    expect(can(principal, "members:invite", { organizationId: orgA })).toBe(true);
  });

  test("a finance role in one organization cannot move or read money in another", () => {
    const principal = principalIn(orgB, "finance");
    for (const permission of ["balances:read", "payouts:read", "payouts:write"] as const) {
      expect(can(principal, permission, { organizationId: orgA })).toBe(false);
      expect(can(principal, permission, { organizationId: orgB })).toBe(true);
    }
  });

  test("is a pure function: the same inputs give the same answer and the input is not mutated", () => {
    const principal = principalIn(orgA, "editor");
    const snapshot = structuredClone(principal);
    expect(can(principal, "links:write", { organizationId: orgA })).toBe(true);
    expect(can(principal, "links:write", { organizationId: orgA })).toBe(true);
    expect(principal).toEqual(snapshot);
  });
});
