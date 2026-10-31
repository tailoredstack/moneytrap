import type { Link } from "@moneytrap/domain";

// The source of truth for a route: the link aggregate plus whether its property and program currently allow traffic.
// Implementations read the Postgres primary, never a replica, so the read is not older than its loadedAt (ADR-007).
export interface RouteSourceRecord {
  readonly link: Link;
  readonly eligible: boolean;
}

export interface RouteSource {
  findByToken(token: string): Promise<RouteSourceRecord | null>;
}
