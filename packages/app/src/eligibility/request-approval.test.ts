import { describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { ProgramApprovalState } from "../ports/network-connector";
import type {
  ProgramApprovalRecord,
  ProgramApprovalStore,
  ProgramApprovalWrite,
  ProgramApprovalWriteOutcome,
} from "../ports/program-approval-store";
import { approvalStatus, readProgramApproval, requestProgramApproval } from "./request-approval";

const orgId = `org_${"0".repeat(25)}1` as Id<"organization">;
const otherOrgId = `org_${"0".repeat(25)}2` as Id<"organization">;
const propertyId = `prp_${"0".repeat(25)}1` as Id<"property">;
const otherPropertyId = `prp_${"0".repeat(25)}2` as Id<"property">;
const programId = `prg_${"0".repeat(25)}1`;
const userId = `usr_${"0".repeat(25)}1`;
const now = new Date("2026-11-01T10:00:00.000Z");
const later = new Date("2026-11-02T10:00:00.000Z");

// Models the adapter contract: a request is written once per property and program, the audit row and event commit with
// it, and the approval is whatever the network last reported for the program. Only setNetworkApproval changes it, as sync does.
class MemoryProgramApprovalStore implements ProgramApprovalStore {
  properties = new Map<string, string>([
    [propertyId, orgId],
    [otherPropertyId, otherOrgId],
  ]);
  programs = new Map<string, ProgramApprovalState | null>([[programId, null]]);
  requests = new Map<string, { organizationId: string; requestedAt: Date }>();
  audits: ProgramApprovalWrite["audit"][] = [];
  events: ProgramApprovalWrite["event"][] = [];

  setNetworkApproval(approval: ProgramApprovalState | null): void {
    this.programs.set(programId, approval);
  }

  async request(write: ProgramApprovalWrite): Promise<ProgramApprovalWriteOutcome> {
    if (this.properties.get(write.propertyId) !== write.organizationId) return { kind: "unknown_property" };
    if (!this.programs.has(write.programId)) return { kind: "unknown_program" };
    const key = `${write.propertyId}|${write.programId}`;
    if (this.requests.has(key)) return { kind: "existing", record: this.view(write.propertyId, write.programId) };
    this.requests.set(key, { organizationId: write.organizationId, requestedAt: write.requestedAt });
    this.audits.push(write.audit);
    this.events.push(write.event);
    return { kind: "recorded", record: this.view(write.propertyId, write.programId) };
  }

  async find(organizationId: Id<"organization">, property: Id<"property">, program: string) {
    const stored = this.requests.get(`${property}|${program}`);
    if (!stored || stored.organizationId !== organizationId) return null;
    return this.view(property, program);
  }

  private view(property: Id<"property">, program: string): ProgramApprovalRecord {
    const stored = this.requests.get(`${property}|${program}`);
    if (!stored) throw new Error("no request stored for the pair");
    return {
      propertyId: property,
      programId: program,
      requestedAt: stored.requestedAt,
      networkApproval: this.programs.get(program) ?? null,
    };
  }
}

let sequence = 0;
const clock = { now: () => now };
const ids = {
  next(kind: string) {
    sequence += 1;
    return `${kind}_${String(sequence).padStart(26, "0")}`;
  },
};
const ctx = {
  db: undefined as never,
  clock,
  ids,
  actor: { type: "user", id: userId },
} as unknown as Ctx;

describe("request program approval (TP-W4-024, TP-W4-025, TP-W4-026)", () => {
  test("a request is stored as requested and is not approved (TP-W4-024)", async () => {
    const store = new MemoryProgramApprovalStore();
    const result = await requestProgramApproval(ctx, store, { organizationId: orgId, propertyId, programId });

    expect(result).toEqual({
      ok: true,
      value: { propertyId, programId, status: "requested", requestedAt: now },
    });
    expect(store.requests.size).toBe(1);
  });

  test("a request for an already approved program still shows the status the network reports", async () => {
    const store = new MemoryProgramApprovalStore();
    store.setNetworkApproval("approved");
    const result = await requestProgramApproval(ctx, store, { organizationId: orgId, propertyId, programId });
    expect(result.ok && result.value.status).toBe("approved");
  });

  test("approval appears only when a later sync reports it (TP-W4-025)", async () => {
    const store = new MemoryProgramApprovalStore();
    await requestProgramApproval(ctx, store, { organizationId: orgId, propertyId, programId });

    store.setNetworkApproval("pending");
    expect((await readProgramApproval(store, { organizationId: orgId, propertyId, programId }))?.status).toBe(
      "requested",
    );

    store.setNetworkApproval(null);
    expect((await readProgramApproval(store, { organizationId: orgId, propertyId, programId }))?.status).toBe(
      "requested",
    );

    store.setNetworkApproval("approved");
    expect((await readProgramApproval(store, { organizationId: orgId, propertyId, programId }))?.status).toBe(
      "approved",
    );
  });

  test("a network rejection is shown as rejected", async () => {
    const store = new MemoryProgramApprovalStore();
    await requestProgramApproval(ctx, store, { organizationId: orgId, propertyId, programId });
    store.setNetworkApproval("rejected");
    expect((await readProgramApproval(store, { organizationId: orgId, propertyId, programId }))?.status).toBe(
      "rejected",
    );
  });

  test("a request never reads as approved while the network has not reported approval", () => {
    const base = { propertyId, programId, requestedAt: now };
    expect(approvalStatus({ ...base, networkApproval: null })).toBe("requested");
    expect(approvalStatus({ ...base, networkApproval: "pending" })).toBe("requested");
    expect(approvalStatus({ ...base, networkApproval: "approved" })).toBe("approved");
  });

  test("a repeat request writes nothing and keeps the first request time", async () => {
    const store = new MemoryProgramApprovalStore();
    await requestProgramApproval(ctx, store, { organizationId: orgId, propertyId, programId });
    const laterClock = { ...ctx, clock: { now: () => later } } as unknown as Ctx;

    const repeat = await requestProgramApproval(laterClock, store, { organizationId: orgId, propertyId, programId });

    expect(repeat.ok && repeat.value.requestedAt).toEqual(now);
    expect(store.audits).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  test("a request records one audit row and one event with the actor", async () => {
    const store = new MemoryProgramApprovalStore();
    await requestProgramApproval(ctx, store, { organizationId: orgId, propertyId, programId });
    expect(store.audits[0]?.metadata).toEqual({ propertyId, programId });
    expect(store.events[0]?.payload).toEqual({ propertyId, programId });
  });

  test("a non-user actor is unauthenticated", async () => {
    const store = new MemoryProgramApprovalStore();
    const system = { ...ctx, actor: { type: "system", id: null } } as unknown as Ctx;
    const result = await requestProgramApproval(system, store, { organizationId: orgId, propertyId, programId });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  test("malformed IDs fail validation before anything is read or written", async () => {
    const store = new MemoryProgramApprovalStore();
    const result = await requestProgramApproval(ctx, store, {
      organizationId: orgId,
      propertyId: "not-a-property",
      programId,
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.requests.size).toBe(0);
  });

  test("an unknown program is not found", async () => {
    const store = new MemoryProgramApprovalStore();
    const result = await requestProgramApproval(ctx, store, {
      organizationId: orgId,
      propertyId,
      programId: `prg_${"0".repeat(25)}9`,
    });
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("a property of another organization is not found, and nothing is written", async () => {
    const store = new MemoryProgramApprovalStore();
    const result = await requestProgramApproval(ctx, store, {
      organizationId: orgId,
      propertyId: otherPropertyId,
      programId,
    });
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(store.requests.size).toBe(0);
  });

  test("a request is not visible to another organization", async () => {
    const store = new MemoryProgramApprovalStore();
    await requestProgramApproval(ctx, store, { organizationId: orgId, propertyId, programId });
    const seen = await readProgramApproval(store, { organizationId: otherOrgId, propertyId, programId });
    expect(seen).toBeNull();
  });

  test("reading a program with no request returns null", async () => {
    const store = new MemoryProgramApprovalStore();
    expect(await readProgramApproval(store, { organizationId: orgId, propertyId, programId })).toBeNull();
  });
});
