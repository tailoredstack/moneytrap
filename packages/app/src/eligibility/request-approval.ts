import { type Id, parseId } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { ProgramApprovalRecord, ProgramApprovalStore } from "../ports/program-approval-store";

// What the publisher sees for a request (spec §5 Program participation, after requested).
export type ProgramApprovalStatus = "requested" | "approved" | "rejected";

export interface ProgramApprovalView {
  propertyId: Id<"property">;
  programId: string;
  status: ProgramApprovalStatus;
  requestedAt: Date;
}

export type RequestApprovalResult =
  | { ok: true; value: ProgramApprovalView }
  | { ok: false; code: "UNAUTHENTICATED" | "VALIDATION_FAILED" | "RESOURCE_NOT_FOUND" };

// The status comes only from the network-reported approval on the program's latest revision. A stored request has no
// say in it, so a request never reads as approved on its own (TP-W4-024, TP-W4-025). Pending or unknown approval keeps
// the request at requested.
export function approvalStatus(record: ProgramApprovalRecord): ProgramApprovalStatus {
  if (record.networkApproval === "approved") return "approved";
  if (record.networkApproval === "rejected") return "rejected";
  return "requested";
}

function toView(record: ProgramApprovalRecord): ProgramApprovalView {
  return {
    propertyId: record.propertyId,
    programId: record.programId,
    status: approvalStatus(record),
    requestedAt: record.requestedAt,
  };
}

// Asks for approval of a program for one property (API-035). The request is stored once per property and program, so
// a repeat call returns the stored request and writes nothing. No input here can set approval: the status is read from
// the network's state, and this action never writes it.
export async function requestProgramApproval(
  ctx: Ctx,
  store: ProgramApprovalStore,
  input: { organizationId: Id<"organization">; propertyId: string; programId: string },
): Promise<RequestApprovalResult> {
  if (ctx.actor.type !== "user" || parseId("user", ctx.actor.id) === null) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  const propertyId = parseId("property", input.propertyId);
  const programId = parseId("program", input.programId);
  if (propertyId === null || programId === null) return { ok: false, code: "VALIDATION_FAILED" };

  const outcome = await store.request({
    organizationId: input.organizationId,
    propertyId,
    programId,
    requestedAt: ctx.clock.now(),
    actor: { type: ctx.actor.type, id: ctx.actor.id as string },
    audit: { id: ctx.ids.next("audit"), metadata: { propertyId, programId } },
    event: { id: ctx.ids.next("event"), payload: { propertyId, programId } },
  });
  if (outcome.kind === "unknown_property" || outcome.kind === "unknown_program") {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }
  return { ok: true, value: toView(outcome.record) };
}

// Reads the status of a request for the organization's own property. Null when no request is stored for the pair.
export async function readProgramApproval(
  store: ProgramApprovalStore,
  input: { organizationId: Id<"organization">; propertyId: Id<"property">; programId: string },
): Promise<ProgramApprovalView | null> {
  const record = await store.find(input.organizationId, input.propertyId, input.programId);
  return record ? toView(record) : null;
}
