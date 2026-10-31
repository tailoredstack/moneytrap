import type { ErrorCode } from "../errors/codes";
import type { Id } from "../ids/ids";

// Account states from DM-001 and spec §5 (User). Only `active` users may perform privileged actions.
export const USER_STATUSES = ["pending", "active", "suspended", "closed"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export interface User {
  readonly id: Id<"user">;
  readonly email: string;
  readonly status: UserStatus;
}

export type UserTransition = { ok: true; value: User } | { ok: false; code: ErrorCode };

export type PrivilegeCheck = { ok: true } | { ok: false; code: ErrorCode };

// Every transition returns a new value. An illegal move is a STATE_CONFLICT and leaves the input untouched.
export function registerUser(input: { id: Id<"user">; email: string }): User {
  return { id: input.id, email: input.email, status: "pending" };
}

export function verifyUser(user: User): UserTransition {
  return move(user, "pending", "active");
}

export function suspendUser(user: User): UserTransition {
  return move(user, "active", "suspended");
}

// Reinstating a suspended account restores it to active. A closed account never reactivates (spec §5).
export function reinstateUser(user: User): UserTransition {
  return move(user, "suspended", "active");
}

export function closeUser(user: User): UserTransition {
  if (user.status === "closed") return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: { ...user, status: "closed" } };
}

// Privileged actions need an active account. Pending, suspended, and closed accounts are refused with FORBIDDEN.
export function assertPrivilegedAllowed(user: User): PrivilegeCheck {
  return user.status === "active" ? { ok: true } : { ok: false, code: "FORBIDDEN" };
}

function move(user: User, from: UserStatus, to: UserStatus): UserTransition {
  if (user.status !== from) return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: { ...user, status: to } };
}
