import type { ErrorCode } from "../errors/codes";
import type { Id } from "../ids/ids";
import { type DestinationResult, validateDestination } from "./destination";

// Link states from DM-027 and spec §5 (Link): draft → active → paused / revoked.
// `revoked` is terminal. Paused links can resume; revoked links cannot.
export const LINK_STATUSES = ["draft", "active", "paused", "revoked"] as const;

export type LinkStatus = (typeof LINK_STATUSES)[number];

// `version` starts at 1 and goes up by one on every state or destination change (blueprint §5.3).
// The route cache keys on it, so a stale cached route never outlives a newer version.
export interface Link {
  readonly id: Id<"link">;
  readonly publisherId: Id<"publisher">;
  readonly propertyId: Id<"property">;
  readonly slug: string;
  readonly destinationUrl: string;
  readonly status: LinkStatus;
  readonly version: number;
}

export type LinkTransition = { ok: true; value: Link } | { ok: false; code: ErrorCode };

// A new link starts in draft at version 1. The slug must not be blank, and the destination must pass the allow-list.
export function createLink(input: {
  id: Id<"link">;
  publisherId: Id<"publisher">;
  propertyId: Id<"property">;
  slug: string;
  destination: string;
  allowedHosts: readonly string[];
}): LinkTransition {
  if (input.slug.trim() === "") return { ok: false, code: "VALIDATION_FAILED" };
  const destination = validateDestination(input.destination, input.allowedHosts);
  if (!destination.ok) return { ok: false, code: destination.code };
  return {
    ok: true,
    value: {
      id: input.id,
      publisherId: input.publisherId,
      propertyId: input.propertyId,
      slug: input.slug,
      destinationUrl: destination.value.url,
      status: "draft",
      version: 1,
    },
  };
}

export function activateLink(link: Link): LinkTransition {
  return move(link, ["draft", "paused"], "active");
}

export function pauseLink(link: Link): LinkTransition {
  return move(link, ["active"], "paused");
}

// Revocation is irreversible. Only a link that has been used (active or paused) can be revoked.
export function revokeLink(link: Link): LinkTransition {
  return move(link, ["active", "paused"], "revoked");
}

// Changing the destination re-runs the allow-list check and bumps the version. Revoked links cannot change.
export function changeDestination(link: Link, destination: string, allowedHosts: readonly string[]): LinkTransition {
  if (link.status === "revoked") return { ok: false, code: "STATE_CONFLICT" };
  const checked: DestinationResult = validateDestination(destination, allowedHosts);
  if (!checked.ok) return { ok: false, code: checked.code };
  return { ok: true, value: { ...link, destinationUrl: checked.value.url, version: link.version + 1 } };
}

// Every transition returns a new value and bumps the version. An illegal move is a STATE_CONFLICT and leaves the input untouched.
function move(link: Link, from: readonly LinkStatus[], to: LinkStatus): LinkTransition {
  if (!from.includes(link.status)) return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: { ...link, status: to, version: link.version + 1 } };
}
