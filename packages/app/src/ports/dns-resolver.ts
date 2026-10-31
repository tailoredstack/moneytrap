// Looks up TXT records for a DNS name. A name with no records resolves to []. A transient failure or timeout rejects,
// so the caller can tell "record missing" (retry later) from "resolver unavailable" (report the provider).
export interface DnsResolver {
  resolveTxt(name: string): Promise<string[]>;
}
