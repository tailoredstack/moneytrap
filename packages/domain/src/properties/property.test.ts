import { describe, expect, test } from "bun:test";
import { type Id, parseId } from "../ids/ids";
import {
  approveProperty,
  createWebsiteProperty,
  markPropertyVerified,
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
