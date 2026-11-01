import type { Link } from "@moneytrap/domain";

// The source of truth for a route: the link aggregate plus whether its property and program currently allow traffic.
// Implementations read the Postgres primary, never a replica, so the read is not older than its loadedAt (ADR-007).
// `allowedHosts` is the program's latest allow-list (WP-5.7). The redirect re-checks the destination against it, so a host
// removed from the allow-list after the link was written stops redirecting. Empty means no destination is allowed.
export interface RouteSourceRecord {
  readonly link: Link;
  readonly eligible: boolean;
  readonly allowedHosts: readonly string[];
}

export interface RouteSource {
  findByToken(token: string): Promise<RouteSourceRecord | null>;
}
