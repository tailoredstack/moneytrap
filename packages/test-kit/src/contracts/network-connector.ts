import { describe, expect, test } from "bun:test";
import type {
  ConnectorFailure,
  ConnectorResult,
  NetworkConnector,
  Page,
  TimeRange,
} from "@moneytrap/app/src/ports/network-connector";
import { CAPABILITY_STATES, CONNECTOR_OPERATIONS, type ConnectorOperation } from "@moneytrap/domain";

// What a connector is asked to do. `healthy` serves data, `disabled-credential` has a credential the upstream refuses,
// and `upstream-unavailable` has an upstream that cannot answer for now.
export type ConnectorContractScenario = "healthy" | "disabled-credential" | "upstream-unavailable";

export interface ConnectorContractFixture {
  connector: NetworkConnector;
  // Values that must never appear in any result, such as the credential the connector was built with.
  secrets: readonly string[];
}

// The records the `healthy` scenario serves, so the suite can assert on them without knowing the upstream.
export interface ConnectorContractData {
  // An advertiser that has at least one program.
  advertiserWithPrograms: string;
  // A program the upstream reports as approved, and one it does not.
  approvedProgramSourceId: string;
  unapprovedProgramSourceId: string;
  // A range holding more than one transaction, and a range holding none.
  populatedRange: TimeRange;
  emptyRange: TimeRange;
}

export interface ConnectorContractAdapter {
  name: string;
  data: ConnectorContractData;
  create(scenario: ConnectorContractScenario): ConnectorContractFixture;
}

type Call = (connector: NetworkConnector, data: ConnectorContractData) => Promise<ConnectorResult<unknown>>;

// One call per operation in spec §6.1, so a profile entry can be checked against what the operation actually does.
const CALLS: Record<ConnectorOperation, Call> = {
  validate_connection: (connector) => connector.validateConnection(),
  discover_advertisers: (connector) => connector.discoverAdvertisers({ cursor: null }),
  discover_programs: (connector, data) =>
    connector.discoverPrograms({ advertiserSourceId: data.advertiserWithPrograms, cursor: null }),
  resolve_tracking_destination: (connector, data) =>
    connector.resolveTrackingDestination({
      propertyId: "prop_contract" as never,
      programSourceId: data.approvedProgramSourceId,
      destinationUrl: "https://shop.example.test/item",
      subId: "click-contract",
    }),
  list_transactions: (connector, data) => connector.listTransactions({ ...data.populatedRange, cursor: null }),
  list_adjustments: (connector, data) => connector.listAdjustments({ ...data.populatedRange, cursor: null }),
  retrieve_settlement_evidence: (connector, data) =>
    connector.retrieveSettlementEvidence({ ...data.populatedRange, cursor: null }),
  receive_notifications: (connector) => connector.receiveNotification({ headers: {}, body: "{}" }),
};

const MAX_PAGES = 50;
const TRANSACTION_STATUSES = ["pending", "approved", "declined", "reversed"];
const APPROVALS = ["approved", "pending", "rejected"];

function failureOf(result: ConnectorResult<unknown>): ConnectorFailure {
  if (result.ok) throw new Error("expected a failure, got a result");
  return result.failure;
}

function valueOfResult<T>(result: ConnectorResult<T>): T {
  if (!result.ok) throw new Error(`expected a result, got ${JSON.stringify(result.failure)}`);
  return result.value;
}

// Follows nextCursor until it is null, so a connector that never ends fails the suite instead of hanging it.
async function drain<T>(fetchPage: (cursor: string | null) => Promise<ConnectorResult<Page<T>>>): Promise<Page<T>[]> {
  const pages: Page<T>[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const page: Page<T> = valueOfResult(await fetchPage(cursor));
    pages.push(page);
    if (page.nextCursor === null) return pages;
    cursor = page.nextCursor;
  }
  throw new Error(`cursor chain did not end within ${MAX_PAGES} pages`);
}

// Money holds a bigint, which JSON cannot carry, so the scan writes it as text.
function scan(value: unknown): string {
  return JSON.stringify(value, (_key, field) => (typeof field === "bigint" ? field.toString() : field));
}

export function runNetworkConnectorContract(adapters: ReadonlyArray<ConnectorContractAdapter>): void {
  describe.each(adapters)("WP-4.3 $name network connector contract", ({ create, data }) => {
    const healthy = () => create("healthy").connector;

    test("TP-W4-001 validate connection returns a capability profile that covers every operation", async () => {
      const check = valueOfResult(await healthy().validateConnection());

      expect(Object.keys(check.capabilities).sort()).toEqual([...CONNECTOR_OPERATIONS].sort());
      for (const state of Object.values(check.capabilities)) expect(CAPABILITY_STATES).toContain(state);
      expect(check.capabilities.validate_connection).toBe("supported");
      expect(Array.isArray(check.permittedScopes)).toBe(true);
    });

    test("TP-W4-003 an operation the profile does not support fails with that state, never as an empty page", async () => {
      const connector = healthy();
      const { capabilities } = valueOfResult(await connector.validateConnection());

      for (const operation of CONNECTOR_OPERATIONS) {
        const state = capabilities[operation];
        if (state === "supported") continue;
        const failure = failureOf(await CALLS[operation](connector, data));
        expect(failure.state).toBe(state);
      }
    });

    test("TP-W4-002 a disabled credential fails every supported operation as not_authorized", async () => {
      const { capabilities } = valueOfResult(await healthy().validateConnection());
      const { connector } = create("disabled-credential");

      expect(failureOf(await connector.validateConnection())).toEqual({ state: "not_authorized" });
      for (const operation of CONNECTOR_OPERATIONS) {
        const failure = failureOf(await CALLS[operation](connector, data));
        // An operation the network never offers may say so, but it never returns data.
        if (capabilities[operation] === "supported") expect(failure).toEqual({ state: "not_authorized" });
      }
    });

    test("TP-W4-004 an upstream that cannot answer is temporarily_unavailable, never an empty page", async () => {
      const { connector } = create("upstream-unavailable");

      for (const operation of ["discover_advertisers", "list_transactions"] as const) {
        const failure = failureOf(await CALLS[operation](connector, data));
        expect(failure.state).toBe("temporarily_unavailable");
        if (failure.state === "temporarily_unavailable" && failure.retryAfterSeconds !== null) {
          expect(Number.isFinite(failure.retryAfterSeconds) && failure.retryAfterSeconds >= 0).toBe(true);
        }
      }
    });

    test("TP-W4-005 advertisers are paged in order with a watermark on every page and no repeats", async () => {
      const pages = await drain((cursor) => healthy().discoverAdvertisers({ cursor }));
      const records = pages.flatMap((page) => page.items);

      expect(records.length).toBeGreaterThan(0);
      expect(new Set(records.map((record) => record.sourceId)).size).toBe(records.length);
      for (const page of pages) {
        expect(page.watermark).toBeInstanceOf(Date);
        expect(Number.isNaN(page.watermark.getTime())).toBe(false);
      }
      for (const record of records) {
        expect(record.sourceId).not.toBe("");
        expect(record.revision).not.toBe("");
        expect(typeof record.name).toBe("string");
      }
    });

    test("TP-W4-006 programs carry source identity, revision, terms, and an explicit approval state", async () => {
      const pages = await drain((cursor) =>
        healthy().discoverPrograms({ advertiserSourceId: data.advertiserWithPrograms, cursor }),
      );
      const programs = pages.flatMap((page) => page.items);

      expect(programs.length).toBeGreaterThan(0);
      for (const program of programs) {
        expect(program.advertiserSourceId).toBe(data.advertiserWithPrograms);
        expect(program.sourceId).not.toBe("");
        expect(program.revision).not.toBe("");
        expect(typeof program.name).toBe("string");
        expect(typeof program.terms).toBe("string");
        expect(program.eligibility === null || typeof program.eligibility === "string").toBe(true);
        expect(program.countries.every((country) => typeof country === "string")).toBe(true);
        expect(program.channels.every((channel) => typeof channel === "string")).toBe(true);
        expect(program.approval === null || APPROVALS.includes(program.approval)).toBe(true);
      }
    });

    test("an advertiser the upstream does not know has no programs, and that is a result rather than a failure", async () => {
      const pages = await drain((cursor) =>
        healthy().discoverPrograms({ advertiserSourceId: "no-such-advertiser", cursor }),
      );

      expect(pages.flatMap((page) => page.items)).toEqual([]);
    });

    test("transactions in the range are paged without repeats, and each has money, a status, and a time", async () => {
      const pages = await drain((cursor) => healthy().listTransactions({ ...data.populatedRange, cursor }));
      const records = pages.flatMap((page) => page.items);

      expect(records.length).toBeGreaterThan(1);
      expect(new Set(records.map((record) => record.sourceId)).size).toBe(records.length);
      for (const record of records) {
        expect(record.revision).not.toBe("");
        expect(TRANSACTION_STATUSES).toContain(record.status);
        expect(typeof record.amount.amount).toBe("bigint");
        expect(record.occurredAt.getTime()).toBeGreaterThanOrEqual(data.populatedRange.from.getTime());
        expect(record.occurredAt.getTime()).toBeLessThan(data.populatedRange.to.getTime());
        expect(record.subId === null || typeof record.subId === "string").toBe(true);
      }
      for (const page of pages) expect(page.watermark).toBeInstanceOf(Date);
    });

    test("a range with no transactions is an empty result, not a failure", async () => {
      const result = valueOfResult(await healthy().listTransactions({ ...data.emptyRange, cursor: null }));

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    test("a tracking link is created for an approved program and keeps the sub-ID", async () => {
      const link = valueOfResult(await CALLS.resolve_tracking_destination(healthy(), data)) as {
        url: string;
        subId: string;
      };

      expect(() => new URL(link.url)).not.toThrow();
      expect(link.subId).toBe("click-contract");
    });

    test("a tracking link is refused for a program that is not approved", async () => {
      const result = await healthy().resolveTrackingDestination({
        propertyId: "prop_contract" as never,
        programSourceId: data.unapprovedProgramSourceId,
        destinationUrl: "https://shop.example.test/item",
        subId: "click-contract",
      });

      expect(failureOf(result)).toEqual({ state: "not_authorized" });
    });

    test("a callback with no valid proof of origin is never accepted", async () => {
      const result = await healthy().receiveNotification({ headers: { "x-forged": "1" }, body: '{"eventId":"evt"}' });

      expect(result.ok).toBe(false);
    });

    test("TP-W4-008 the same request returns identical results every time", async () => {
      const first = healthy();
      const second = healthy();
      const input = { ...data.populatedRange, cursor: null };

      expect(await first.listTransactions(input)).toEqual(await second.listTransactions(input));
      expect(await first.discoverAdvertisers({ cursor: null })).toEqual(
        await first.discoverAdvertisers({ cursor: null }),
      );
    });

    test("a cursor issued for one query is refused by another", async () => {
      const connector = healthy();
      const advertisers = valueOfResult(await connector.discoverAdvertisers({ cursor: null }));
      const transactions = valueOfResult(await connector.listTransactions({ ...data.populatedRange, cursor: null }));
      const cursor = advertisers.nextCursor ?? transactions.nextCursor;
      expect(cursor).not.toBeNull();

      await expect(connector.listTransactions({ ...data.populatedRange, cursor: "not-a-cursor" })).rejects.toThrow();
      if (advertisers.nextCursor !== null) {
        await expect(
          connector.listTransactions({ ...data.populatedRange, cursor: advertisers.nextCursor }),
        ).rejects.toThrow();
      }
    });

    test("TP-W4-007 no result or failure carries a credential, and a failure has only its typed fields", async () => {
      for (const scenario of ["healthy", "disabled-credential", "upstream-unavailable"] as const) {
        const { connector, secrets } = create(scenario);
        for (const operation of CONNECTOR_OPERATIONS) {
          const result = await CALLS[operation](connector, data);
          const text = scan(result);
          for (const secret of secrets) expect(text).not.toContain(secret);
          if (!result.ok) {
            expect(Object.keys(result.failure).every((key) => key === "state" || key === "retryAfterSeconds")).toBe(
              true,
            );
          }
        }
      }
    });
  });
}
