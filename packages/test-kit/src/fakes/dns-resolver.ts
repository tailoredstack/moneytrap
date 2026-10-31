import type { DnsResolver } from "@moneytrap/app/src/ports/dns-resolver";

/** Programmable TXT records. A name with no records resolves to [], like NXDOMAIN. Set `failure` to simulate an outage. */
export class FakeDnsResolver implements DnsResolver {
  private readonly records = new Map<string, string[]>();
  readonly lookups: string[] = [];
  failure: Error | null = null;

  setTxt(name: string, values: string[]): void {
    this.records.set(name, [...values]);
  }

  async resolveTxt(name: string): Promise<string[]> {
    this.lookups.push(name);
    if (this.failure) throw this.failure;
    return [...(this.records.get(name) ?? [])];
  }
}
