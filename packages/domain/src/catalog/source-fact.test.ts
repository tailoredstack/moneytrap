import { describe, expect, test } from "bun:test";
import {
  type AdvertiserFactPayload,
  decideRevision,
  type ProgramFactPayload,
  validateSourceIdentity,
} from "./source-fact";

const advertiser: AdvertiserFactPayload = { name: "Acme Outdoors" };

const program: ProgramFactPayload = {
  name: "Acme Summer",
  terms: "30 day cookie",
  eligibility: "Adults only",
  countries: ["GB", "IE"],
  channels: ["web", "email"],
  approval: "approved",
};

describe("decideRevision (DM-021, DM-022, TP-W4-008, TP-W4-009)", () => {
  test("the first sighting of a source record creates revision 1", () => {
    expect(decideRevision(null, { sourceRevision: "r1", payload: program })).toEqual({ kind: "create" });
  });

  test("the same source revision and payload twice creates no new revision", () => {
    const latest = { sourceRevision: "r1", payload: program };
    expect(decideRevision(latest, { sourceRevision: "r1", payload: { ...program } })).toEqual({ kind: "unchanged" });
  });

  test("a changed commission term in the payload creates a new revision", () => {
    const latest = { sourceRevision: "r1", payload: program };
    const changed = { ...program, terms: "30 day cookie, 12% commission" };
    expect(decideRevision(latest, { sourceRevision: "r2", payload: changed })).toEqual({ kind: "revise" });
  });

  test("a new upstream revision with identical content still creates a revision", () => {
    const latest = { sourceRevision: "r1", payload: advertiser };
    expect(decideRevision(latest, { sourceRevision: "r2", payload: advertiser })).toEqual({ kind: "revise" });
  });

  test("the order of countries and channels does not count as a change", () => {
    const latest = { sourceRevision: "r1", payload: program };
    const reordered = { ...program, countries: ["IE", "GB"], channels: ["email", "web"] };
    expect(decideRevision(latest, { sourceRevision: "r1", payload: reordered })).toEqual({ kind: "unchanged" });
  });

  test("a null approval (not exposed by the network) differs from an approved one", () => {
    const latest = { sourceRevision: "r1", payload: program };
    expect(decideRevision(latest, { sourceRevision: "r1", payload: { ...program, approval: null } })).toEqual({
      kind: "revise",
    });
  });
});

describe("validateSourceIdentity", () => {
  test("accepts a non-blank source ID and revision", () => {
    expect(validateSourceIdentity({ sourceId: "prg-42", revision: "2026-10-01" })).toEqual({ ok: true });
  });

  test("rejects a blank source ID, because identity is what upserts match on", () => {
    expect(validateSourceIdentity({ sourceId: "  ", revision: "r1" })).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });

  test("rejects a blank revision, because an unversioned fact cannot be compared", () => {
    expect(validateSourceIdentity({ sourceId: "prg-42", revision: "" })).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });
});
