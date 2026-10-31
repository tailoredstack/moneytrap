import { describe, expect, test } from "bun:test";
import { type Id, parseId } from "../ids/ids";
import { activateLink, changeDestination, createLink, type Link, pauseLink, revokeLink } from "./link";

const linkId = parseId("link", "lnk_00000000000000000000000000") as Id<"link">;
const publisherId = parseId("publisher", "pub_00000000000000000000000000") as Id<"publisher">;
const propertyId = parseId("property", "prp_00000000000000000000000000") as Id<"property">;
const allowed = ["shop.example.com"];
const destination = "https://shop.example.com/item";

function draftLink(): Link {
  const result = createLink({
    id: linkId,
    publisherId,
    propertyId,
    slug: "spring",
    destination,
    allowedHosts: allowed,
  });
  if (!result.ok) throw new Error("fixture: create failed");
  return result.value;
}

function activeLink(): Link {
  const result = activateLink(draftLink(), allowed);
  if (!result.ok) throw new Error("fixture: activate failed");
  return result.value;
}

describe("Link aggregate", () => {
  test("a new link starts in draft at version 1", () => {
    const link = draftLink();
    expect(link).toEqual({
      id: linkId,
      publisherId,
      propertyId,
      slug: "spring",
      destinationUrl: "https://shop.example.com/item",
      status: "draft",
      version: 1,
    });
  });

  test("a blank slug is VALIDATION_FAILED", () => {
    const result = createLink({ id: linkId, publisherId, propertyId, slug: "  ", destination, allowedHosts: allowed });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
  });

  test("TP-W5-003 and TP-W5-004 a destination outside the allow-list is rejected at creation", () => {
    const unsafe = createLink({
      id: linkId,
      publisherId,
      propertyId,
      slug: "x",
      destination: "javascript:alert(1)",
      allowedHosts: allowed,
    });
    expect(unsafe).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    const offList = createLink({
      id: linkId,
      publisherId,
      propertyId,
      slug: "x",
      destination: "https://evil.example.net/",
      allowedHosts: allowed,
    });
    expect(offList).toEqual({ ok: false, code: "VALIDATION_FAILED" });
  });

  test("TP-W5-001 draft → active is allowed and bumps the version", () => {
    const result = activateLink(draftLink(), allowed);
    expect(result.ok && result.value.status).toBe("active");
    expect(result.ok && result.value.version).toBe(2);
  });

  test("a host removed from the allow-list after drafting blocks activation, and the draft is untouched", () => {
    const link = draftLink();
    expect(activateLink(link, [])).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    expect(link.status).toBe("draft");
    expect(link.version).toBe(1);
  });

  test("TP-W5-010 pause then resume changes state and bumps the version each time", () => {
    const paused = pauseLink(activeLink());
    expect(paused.ok && paused.value).toMatchObject({ status: "paused", version: 3 });
    const resumed = activateLink(paused.ok ? paused.value : activeLink(), allowed);
    expect(resumed.ok && resumed.value).toMatchObject({ status: "active", version: 4 });
  });

  test("TP-W5-002 revoked → active is rejected", () => {
    const revoked = revokeLink(activeLink());
    if (!revoked.ok) throw new Error("fixture: revoke failed");
    expect(activateLink(revoked.value, allowed)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(activateLink(revoked.value, [])).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(pauseLink(revoked.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("TP-W5-011 revoke is irreversible and only from active or paused", () => {
    const revoked = revokeLink(activeLink());
    expect(revoked.ok && revoked.value).toMatchObject({ status: "revoked", version: 3 });
    expect(revokeLink(draftLink())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("an illegal transition leaves the input untouched", () => {
    const link = draftLink();
    expect(pauseLink(link)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(link.status).toBe("draft");
    expect(link.version).toBe(1);
  });

  test("TP-W5-009 changing the destination re-validates and bumps the version", () => {
    const changed = changeDestination(activeLink(), "https://shop.example.com/other", allowed);
    expect(changed.ok && changed.value).toMatchObject({ destinationUrl: "https://shop.example.com/other", version: 3 });

    const rejected = changeDestination(activeLink(), "https://evil.example.net/", allowed);
    expect(rejected).toEqual({ ok: false, code: "VALIDATION_FAILED" });
  });

  test("a revoked link cannot change destination", () => {
    const revoked = revokeLink(activeLink());
    if (!revoked.ok) throw new Error("fixture: revoke failed");
    expect(changeDestination(revoked.value, destination, allowed)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });
});
