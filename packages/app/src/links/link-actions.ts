import {
  activateLink,
  changeDestination,
  createLink,
  type DenyReason,
  type EligibilityDecision,
  type ErrorCode,
  type Id,
  type Link,
  type LinkTransition,
  monetizationDenial,
  parseId,
  pauseLink,
  revokeLink,
  validateDestination,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type {
  LinkAction,
  LinkAudit,
  LinkEvent,
  LinkPolicy,
  LinkRecord,
  LinkStore,
  LinkWritePrecondition,
} from "../ports/link-store";
import type { PropertyReviewStore } from "../ports/property-review-store";

export interface LinkDeps {
  links: LinkStore;
  properties: PropertyReviewStore;
  policy: LinkPolicy;
}

// PROGRAM_INELIGIBLE carries the eligibility reasons, and STATE_CONFLICT with reason "property_not_approved" carries the
// precondition that stopped a monetized command (TP-W5-006, TP-W5-007).
export type LinkActionDenial =
  | { ok: false; code: "UNAUTHENTICATED" | "VALIDATION_FAILED" | "RESOURCE_NOT_FOUND" }
  | { ok: false; code: "STATE_CONFLICT"; reason?: "property_not_approved" }
  | { ok: false; code: "PROGRAM_INELIGIBLE"; reasons: readonly DenyReason[] };

export interface LinkView {
  id: Id<"link">;
  propertyId: Id<"property">;
  programId: Id<"program">;
  destinationUrl: string;
  status: Link["status"];
  version: number;
}

export type LinkResult = { ok: true; value: LinkView } | LinkActionDenial;

export interface PreviewView {
  propertyId: Id<"property">;
  programId: Id<"program">;
  destinationUrl: string;
  host: string;
}

export type PreviewResult = { ok: true; value: PreviewView } | LinkActionDenial;

interface Actor {
  type: "user";
  id: string;
}

// Only a signed-in user can change a link. The route guard has already checked links:write (or links:read for preview)
// on the organization the caller names, as with submitProperty.
function actorOf(ctx: Ctx): Actor | null {
  if (ctx.actor.type !== "user" || ctx.actor.id === null || parseId("user", ctx.actor.id) === null) return null;
  return { type: "user", id: ctx.actor.id };
}

// The domain returns only validation and state codes from these transitions. Anything else maps to VALIDATION_FAILED,
// so an unexpected code is never passed through with the wrong type.
function domainDenial(code: ErrorCode): LinkActionDenial {
  return code === "STATE_CONFLICT" ? { ok: false, code: "STATE_CONFLICT" } : { ok: false, code: "VALIDATION_FAILED" };
}

function view(record: LinkRecord): LinkView {
  return {
    id: record.link.id,
    propertyId: record.link.propertyId,
    programId: record.programId,
    destinationUrl: record.link.destinationUrl,
    status: record.link.status,
    version: record.link.version,
  };
}

// Create, preview, edit, and resume all monetize, so they pass the same gate: the property must be approved (CT-006),
// the latest eligibility decision for the pair must allow the program (CT-010), and the destination must be on the
// program's allow-list. A denial returns before anything is written.
async function gate(
  deps: LinkDeps,
  organizationId: Id<"organization">,
  propertyId: Id<"property">,
  programId: Id<"program">,
): Promise<{ ok: true; publisherId: Id<"publisher">; hosts: readonly string[] } | LinkActionDenial> {
  const property = await deps.properties.find(propertyId);
  if (!property || property.organizationId !== organizationId) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }
  if (monetizationDenial(property.property)) {
    return { ok: false, code: "STATE_CONFLICT", reason: "property_not_approved" };
  }

  const decision: EligibilityDecision | null = await deps.policy.latestEligibility(
    organizationId,
    propertyId,
    programId,
  );
  if (!decision || decision.decision === "deny") {
    return {
      ok: false,
      code: "PROGRAM_INELIGIBLE",
      reasons: decision?.decision === "deny" ? decision.reasons : ["unknown"],
    };
  }

  const hosts = await deps.policy.allowedHosts(organizationId, programId);
  return { ok: true, publisherId: property.property.publisherId, hosts };
}

// Writes the change with its audit row and outbox event in one store call. The store refuses the write when the version
// moved or the precondition no longer holds, and then the caller gets STATE_CONFLICT and nothing is written.
async function commit(
  ctx: Ctx,
  deps: LinkDeps,
  input: {
    actor: Actor;
    organizationId: Id<"organization">;
    record: LinkRecord;
    action: LinkAction;
    expectedVersion: number | null;
    precondition: LinkWritePrecondition | null;
  },
): Promise<LinkResult> {
  const { link } = input.record;
  const audit: LinkAudit = {
    id: ctx.ids.next("audit"),
    organizationId: input.organizationId,
    actor: input.actor,
    action: input.action,
    entityType: "link",
    entityId: link.id,
    metadata: {},
    occurredAt: ctx.clock.now(),
  };
  const event: LinkEvent = {
    id: ctx.ids.next("event"),
    topic: input.action === "create" ? "link.created" : "link.updated",
    aggregateId: link.id,
    aggregateVersion: link.version,
    payload: { action: input.action, status: link.status },
  };

  const applied =
    input.expectedVersion === null
      ? await deps.links.insert({ record: input.record, audit, event, precondition: input.precondition })
      : await deps.links.update({
          organizationId: input.organizationId,
          expectedVersion: input.expectedVersion,
          record: input.record,
          audit,
          event,
          precondition: input.precondition,
        });
  if (applied) return { ok: true, value: view(input.record) };
  return refusalOf(deps, input.organizationId, input.precondition);
}

// A refused write has one of two causes: the version moved (a plain STATE_CONFLICT), or the gate no longer holds. The
// gate is read again so the caller learns the reason: the property or the decision, or a host that left the allow-list.
async function refusalOf(
  deps: LinkDeps,
  organizationId: Id<"organization">,
  precondition: LinkWritePrecondition | null,
): Promise<LinkResult> {
  if (!precondition) return { ok: false, code: "STATE_CONFLICT" };
  const recheck = await gate(deps, organizationId, precondition.propertyId, precondition.programId);
  if (!recheck.ok) return recheck;
  if (!recheck.hosts.includes(precondition.host)) return { ok: false, code: "VALIDATION_FAILED" };
  return { ok: false, code: "STATE_CONFLICT" };
}

// The host a monetized write routes to. The destination was validated before this, so the URL always parses.
function hostOf(url: string): string {
  return new URL(url).hostname;
}

export interface PreviewLinkInput {
  organizationId: Id<"organization">;
  propertyId: string;
  programId: string;
  destination: string;
}

// Shows the normalised destination a create would store, and writes nothing (TP-W5-008, TP-W5-040). It runs the same
// checks as createLink, so a preview that succeeds means the create will pass them, unless the state changes first.
export async function previewLink(ctx: Ctx, deps: LinkDeps, input: PreviewLinkInput): Promise<PreviewResult> {
  if (!actorOf(ctx)) return { ok: false, code: "UNAUTHENTICATED" };
  const propertyId = parseId("property", input.propertyId);
  const programId = parseId("program", input.programId);
  if (propertyId === null || programId === null) return { ok: false, code: "VALIDATION_FAILED" };

  const checked = await gate(deps, input.organizationId, propertyId, programId);
  if (!checked.ok) return checked;
  const destination = validateDestination(input.destination, checked.hosts);
  if (!destination.ok) return { ok: false, code: destination.code };
  return {
    ok: true,
    value: { propertyId, programId, destinationUrl: destination.value.url, host: destination.value.host },
  };
}

export interface CreateLinkInput {
  organizationId: Id<"organization">;
  propertyId: string;
  programId: string;
  destination: string;
}

// Creates and activates a link for an approved property (UC11, API-036). The link is stored once, already active, so no
// draft row is visible. The slug is the new link ID, which is unique and URL-safe.
export async function createActiveLink(ctx: Ctx, deps: LinkDeps, input: CreateLinkInput): Promise<LinkResult> {
  const actor = actorOf(ctx);
  if (!actor) return { ok: false, code: "UNAUTHENTICATED" };
  const propertyId = parseId("property", input.propertyId);
  const programId = parseId("program", input.programId);
  if (propertyId === null || programId === null) return { ok: false, code: "VALIDATION_FAILED" };

  const checked = await gate(deps, input.organizationId, propertyId, programId);
  if (!checked.ok) return checked;

  const id = ctx.ids.next("link");
  const created = createLink({
    id,
    publisherId: checked.publisherId,
    propertyId,
    slug: id,
    destination: input.destination,
    allowedHosts: checked.hosts,
  });
  if (!created.ok) return domainDenial(created.code);
  const active = activateLink(created.value, checked.hosts);
  if (!active.ok) return domainDenial(active.code);

  return commit(ctx, deps, {
    actor,
    organizationId: input.organizationId,
    record: { link: active.value, organizationId: input.organizationId, programId },
    action: "create",
    expectedVersion: null,
    precondition: { propertyId, programId, host: hostOf(active.value.destinationUrl) },
  });
}

// Loads a link inside the caller's organization. A link of another tenant is RESOURCE_NOT_FOUND.
async function loadLink(
  deps: LinkDeps,
  organizationId: Id<"organization">,
  linkId: string,
): Promise<{ ok: true; record: LinkRecord } | LinkActionDenial> {
  const id = parseId("link", linkId);
  if (id === null) return { ok: false, code: "VALIDATION_FAILED" };
  const record = await deps.links.find(organizationId, id);
  if (!record) return { ok: false, code: "RESOURCE_NOT_FOUND" };
  return { ok: true, record };
}

// Changes the destination of a link (API-039). A revoked link reports STATE_CONFLICT before the gate runs, so a revoked
// link never reports a property or eligibility reason. The destination is re-checked against the program's allow-list,
// and the version goes up only when the change applies.
export async function editLinkDestination(
  ctx: Ctx,
  deps: LinkDeps,
  input: { organizationId: Id<"organization">; linkId: string; destination: string },
): Promise<LinkResult> {
  const actor = actorOf(ctx);
  if (!actor) return { ok: false, code: "UNAUTHENTICATED" };
  const loaded = await loadLink(deps, input.organizationId, input.linkId);
  if (!loaded.ok) return loaded;
  const { record } = loaded;
  if (record.link.status === "revoked") return { ok: false, code: "STATE_CONFLICT" };

  const checked = await gate(deps, input.organizationId, record.link.propertyId, record.programId);
  if (!checked.ok) return checked;

  const changed = changeDestination(record.link, input.destination, checked.hosts);
  if (!changed.ok) return domainDenial(changed.code);
  return commit(ctx, deps, {
    actor,
    organizationId: input.organizationId,
    record: { ...record, link: changed.value },
    action: "edit",
    expectedVersion: record.link.version,
    precondition: {
      propertyId: record.link.propertyId,
      programId: record.programId,
      host: hostOf(changed.value.destinationUrl),
    },
  });
}

// Pauses an active link. Pausing only reduces monetization, so it is not blocked by eligibility; a stale or unknown
// link is still refused by tenant and state checks.
export async function pauseLinkAction(
  ctx: Ctx,
  deps: LinkDeps,
  input: { organizationId: Id<"organization">; linkId: string },
): Promise<LinkResult> {
  return transition(ctx, deps, input, "pause", pauseLink);
}

// Resumes a paused link. Resuming monetizes again, so it passes the gate and re-checks the destination (activateLink).
// A revoked link reports STATE_CONFLICT before the gate runs.
export async function resumeLinkAction(
  ctx: Ctx,
  deps: LinkDeps,
  input: { organizationId: Id<"organization">; linkId: string },
): Promise<LinkResult> {
  const actor = actorOf(ctx);
  if (!actor) return { ok: false, code: "UNAUTHENTICATED" };
  const loaded = await loadLink(deps, input.organizationId, input.linkId);
  if (!loaded.ok) return loaded;
  const { record } = loaded;
  if (record.link.status === "revoked") return { ok: false, code: "STATE_CONFLICT" };

  const checked = await gate(deps, input.organizationId, record.link.propertyId, record.programId);
  if (!checked.ok) return checked;

  const resumed = activateLink(record.link, checked.hosts);
  if (!resumed.ok) return domainDenial(resumed.code);
  return commit(ctx, deps, {
    actor,
    organizationId: input.organizationId,
    record: { ...record, link: resumed.value },
    action: "resume",
    expectedVersion: record.link.version,
    precondition: {
      propertyId: record.link.propertyId,
      programId: record.programId,
      host: hostOf(resumed.value.destinationUrl),
    },
  });
}

// Revokes an active or paused link. Revocation is irreversible and is never blocked by eligibility, so a link can always
// be stopped.
export async function revokeLinkAction(
  ctx: Ctx,
  deps: LinkDeps,
  input: { organizationId: Id<"organization">; linkId: string },
): Promise<LinkResult> {
  return transition(ctx, deps, input, "revoke", revokeLink);
}

async function transition(
  ctx: Ctx,
  deps: LinkDeps,
  input: { organizationId: Id<"organization">; linkId: string },
  action: "pause" | "revoke",
  step: (link: Link) => LinkTransition,
): Promise<LinkResult> {
  const actor = actorOf(ctx);
  if (!actor) return { ok: false, code: "UNAUTHENTICATED" };
  const loaded = await loadLink(deps, input.organizationId, input.linkId);
  if (!loaded.ok) return loaded;
  const { record } = loaded;

  const next = step(record.link);
  if (!next.ok) return domainDenial(next.code);
  return commit(ctx, deps, {
    actor,
    organizationId: input.organizationId,
    record: { ...record, link: next.value },
    action,
    expectedVersion: record.link.version,
    precondition: null,
  });
}
