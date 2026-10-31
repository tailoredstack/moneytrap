import { describe, expect, test } from "bun:test";
import { PERMISSIONS, type Permission, ROLE_PERMISSIONS, ROLES } from "@moneytrap/domain";
import { roles } from "./access";

// TP-W2-032: each Better Auth role authorizes exactly the permissions the domain map grants it. Better Auth
// reads the same map through `roles`, so the two cannot drift apart.
describe("TP-W2-032 Better Auth access control matches the domain role map", () => {
  for (const role of ROLES) {
    test(`${role} authorizes exactly its domain permissions`, () => {
      for (const permission of PERMISSIONS) {
        const colon = permission.indexOf(":");
        const resource = permission.slice(0, colon);
        const action = permission.slice(colon + 1);
        const result = roles[role].authorize({ [resource]: [action] });
        expect({ permission, granted: result.success }).toEqual({
          permission,
          granted: ROLE_PERMISSIONS[role].includes(permission as Permission),
        });
      }
    });
  }

  test("Better Auth's own member and invitation checks follow the member and invitation grants", () => {
    expect(roles.owner.authorize({ invitation: ["create"] }).success).toBe(true);
    expect(roles.admin.authorize({ member: ["delete"] }).success).toBe(true);
    expect(roles.editor.authorize({ invitation: ["create"] }).success).toBe(false);
    expect(roles.viewer.authorize({ member: ["update"] }).success).toBe(false);
  });

  // The catalog has no role-change, direct-add, or organization-delete operation, so Better Auth must deny them
  // to every role. Members join through invitation acceptance (API-020), not a direct add.
  test("operations with no catalog endpoint are denied to every role", () => {
    for (const role of ROLES) {
      expect(roles[role].authorize({ member: ["update"] }).success).toBe(false);
      expect(roles[role].authorize({ member: ["create"] }).success).toBe(false);
      expect(roles[role].authorize({ organization: ["delete"] }).success).toBe(false);
    }
  });
});
