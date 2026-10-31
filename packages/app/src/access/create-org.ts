import { type Id, parseId, parseOrganizationInput } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { OrganizationStore } from "../ports/organization-store";

export type CreateOrganizationResult =
  | { ok: true; value: { id: Id<"organization">; status: "active" } }
  | { ok: false; code: "UNAUTHENTICATED" }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string };

// The creator becomes the owner. The owner comes from the authenticated actor, never from the request body.
export async function createOrganization(
  ctx: Ctx,
  store: OrganizationStore,
  raw: unknown,
): Promise<CreateOrganizationResult> {
  const creatorId = ctx.actor.type === "user" ? parseId("user", ctx.actor.id) : null;
  if (!creatorId) return { ok: false, code: "UNAUTHENTICATED" };

  const parsed = parseOrganizationInput(raw);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };

  const now = ctx.clock.now();
  const id = ctx.ids.next("organization");
  await store.createWithOwner({
    organization: {
      id,
      name: parsed.value.name,
      country: parsed.value.country,
      baseCurrency: parsed.value.baseCurrency,
      status: "active",
      createdBy: creatorId,
      createdAt: now,
      updatedAt: now,
    },
    ownerMembership: { organizationId: id, userId: creatorId, role: "owner" },
  });
  return { ok: true, value: { id, status: "active" } };
}
