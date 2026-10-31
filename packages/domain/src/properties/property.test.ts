import { describe, expect, test } from "bun:test";
import { type Id, parseId } from "../ids/ids";
import {
  approveProperty,
  createWebsiteProperty,
  isMonetizable,
  markPropertyVerified,
  monetizationDenial,
  reinstateProperty,
  rejectProperty,
  requestPropertyVerification,
  submitPropertyForReview,
  suspendProperty,
} from "./property";

const propertyId = parseId("property", "prp_00000000000000000000000000") as Id<"property">;
const publisherId = parseId("publisher", "pub_00000000000000000000000000") as Id<"publisher">;

function draftProperty() {
  const result = createWebsiteProperty({ id: propertyId, publisherId, canonicalIdentifier: "Example.COM " });
  if (!result.ok) throw new Error("fixture: create failed");
  return result.value;
}

function verificationPendingProperty() {
  const result = requestPropertyVerification(draftProperty());
  if (!result.ok) throw new Error("fixture: request verification failed");
  return result.value;
}

function verifiedProperty() {
  const result = markPropertyVerified(verificationPendingProperty());
  if (!result.ok) throw new Error("fixture: mark verified failed");
  return result.value;
}

function reviewPendingProperty() {
  const result = submitPropertyForReview(verifiedProperty());
  if (!result.ok) throw new Error("fixture: submit for review failed");
  return result.value;
}

function approvedProperty() {
  const result = approveProperty(reviewPendingProperty());
  if (!result.ok) throw new Error("fixture: approve failed");
  return result.value;
}

describe("Property aggregate", () => {
  test("TP-W3-008 creating a website property starts in draft", () => {
    const result = createWebsiteProperty({ id: propertyId, publisherId, canonicalIdentifier: "Example.COM " });
    expect(result).toEqual({
      ok: true,
      value: {
        id: propertyId,
        publisherId,
        type: "website",
        canonicalIdentifier: "Example.COM ",
        normalizedIdentifier: "example.com",
        status: "draft",
      },
    });
  });

  test("creating a property with a blank identifier is VALIDATION_FAILED", () => {
    const result = createWebsiteProperty({ id: propertyId, publisherId, canonicalIdentifier: "   " });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
  });

  test("draft → verification pending → verified → review pending → approved", () => {
    const pending = requestPropertyVerification(draftProperty());
    expect(pending.ok && pending.value.status).toBe("verification_pending");

    const verified = markPropertyVerified(verificationPendingProperty());
    expect(verified.ok && verified.value.status).toBe("verified");

    const review = submitPropertyForReview(verifiedProperty());
    expect(review.ok && review.value.status).toBe("review_pending");

    const approved = approveProperty(reviewPendingProperty());
    expect(approved.ok && approved.value.status).toBe("approved");
  });

  test("TP-W3-002 draft → approved is rejected with STATE_CONFLICT", () => {
    expect(approveProperty(draftProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("verified is never treated as approved: verified → approved is STATE_CONFLICT", () => {
    expect(approveProperty(verifiedProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("a property must be verified before review, and draft cannot skip verification", () => {
    expect(submitPropertyForReview(draftProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(submitPropertyForReview(verificationPendingProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(markPropertyVerified(draftProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(requestPropertyVerification(verifiedProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("TP-W3-017 review pending → rejected with a reason", () => {
    const result = rejectProperty(reviewPendingProperty(), "Site is parked");
    expect(result).toEqual({
      ok: true,
      value: { ...reviewPendingProperty(), status: "rejected", rejectionReason: "Site is parked" },
    });
  });

  test("rejecting without a reason is VALIDATION_FAILED", () => {
    expect(rejectProperty(reviewPendingProperty(), "  ")).toEqual({ ok: false, code: "VALIDATION_FAILED" });
  });

  test("rejecting from a state other than review pending is STATE_CONFLICT", () => {
    expect(rejectProperty(verifiedProperty(), "reason")).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(rejectProperty(approvedProperty(), "reason")).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("rejected is terminal in this aggregate", () => {
    const rejected = rejectProperty(reviewPendingProperty(), "Site is parked");
    if (!rejected.ok) throw new Error("fixture: reject failed");
    expect(approveProperty(rejected.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(submitPropertyForReview(rejected.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("approved → suspended", () => {
    const result = suspendProperty(approvedProperty());
    expect(result.ok && result.value.status).toBe("suspended");
  });

  test("only approved properties can be suspended", () => {
    expect(suspendProperty(draftProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(suspendProperty(verifiedProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(suspendProperty(reviewPendingProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("suspended cannot be approved again in this aggregate (reinstatement is WP-3.7)", () => {
    const suspended = suspendProperty(approvedProperty());
    if (!suspended.ok) throw new Error("fixture: suspend failed");
    expect(approveProperty(suspended.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("transitions return new values and leave the input untouched on success or failure", () => {
    const draft = draftProperty();
    const before = { ...draft };
    const pending = requestPropertyVerification(draft);
    expect(pending.ok && pending.value).not.toBe(draft);
    expect(draft).toEqual(before);

    const illegal = approveProperty(draft);
    expect(illegal.ok).toBe(false);
    expect(draft).toEqual(before);
  });
});

// CT-006: the verified-vs-approved distinction is confirmed here for every action that monetizes a property.
describe("monetization is limited to approved properties (CT-006)", () => {
  test("TP-W3-015 a verified property is not monetizable and the denial reason is not approved", () => {
    expect(isMonetizable(verifiedProperty())).toBe(false);
    expect(monetizationDenial(verifiedProperty())).toBe("not approved");
  });

  test("a property in review is not monetizable until a reviewer approves it", () => {
    expect(isMonetizable(reviewPendingProperty())).toBe(false);
    expect(monetizationDenial(reviewPendingProperty())).toBe("not approved");
  });

  test("TP-W3-016 an approved property is monetizable and has no denial", () => {
    expect(isMonetizable(approvedProperty())).toBe(true);
    expect(monetizationDenial(approvedProperty())).toBeNull();
  });

  test("a rejected property is not monetizable", () => {
    const rejected = rejectProperty(reviewPendingProperty(), "Site is parked");
    if (!rejected.ok) throw new Error("fixture: reject failed");
    expect(isMonetizable(rejected.value)).toBe(false);
    expect(monetizationDenial(rejected.value)).toBe("not approved");
  });
});

// WP-3.7: suspension stops monetization and reinstatement restores it, with no other path back to approved.
describe("suspension and reinstatement (WP-3.7)", () => {
  function suspendedProperty() {
    const result = suspendProperty(approvedProperty());
    if (!result.ok) throw new Error("fixture: suspend failed");
    return result.value;
  }

  test("TP-W3-018 suspending an approved property makes it suspended and not monetizable", () => {
    const suspended = suspendedProperty();
    expect(suspended.status).toBe("suspended");
    expect(isMonetizable(suspended)).toBe(false);
    expect(monetizationDenial(suspended)).toBe("not approved");
  });

  test("TP-W3-022 reinstating a suspended property makes it approved and monetizable again", () => {
    const reinstated = reinstateProperty(suspendedProperty());
    expect(reinstated.ok && reinstated.value.status).toBe("approved");
    if (!reinstated.ok) throw new Error("unexpected reinstate failure");
    expect(isMonetizable(reinstated.value)).toBe(true);
  });

  test("only a suspended property can be reinstated; an approved one is STATE_CONFLICT", () => {
    expect(reinstateProperty(approvedProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(reinstateProperty(reviewPendingProperty())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("reinstatement leaves the input property untouched", () => {
    const suspended = suspendedProperty();
    const before = { ...suspended };
    reinstateProperty(suspended);
    expect(suspended).toEqual(before);
  });
});
