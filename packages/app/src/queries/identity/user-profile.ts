import type { UserProfileDto } from "@moneytrap/schema/src/identity";
import type { Ctx } from "../../ctx";

// Read-only query for one user's domain profile (DM-001). It joins Better Auth's "user" row for the
// email and returns a DTO. Missing profiles return null; nothing is invented.
export interface IdentityDatabase {
  user: { id: string; email: string };
  user_profiles: {
    user_id: string;
    status: UserProfileDto["status"];
    auth_version: number;
    locale: string;
    created_at: Date;
    updated_at: Date;
  };
}

export async function getUserProfile(
  ctx: Pick<Ctx<IdentityDatabase>, "db">,
  userId: string,
): Promise<UserProfileDto | null> {
  const row = await ctx.db
    .selectFrom("user_profiles")
    .innerJoin("user", "user.id", "user_profiles.user_id")
    .select([
      "user_profiles.user_id as id",
      "user.email",
      "user_profiles.status",
      "user_profiles.auth_version",
      "user_profiles.locale",
      "user_profiles.created_at",
      "user_profiles.updated_at",
    ])
    .where("user_profiles.user_id", "=", userId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    authVersion: row.auth_version,
    locale: row.locale,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
