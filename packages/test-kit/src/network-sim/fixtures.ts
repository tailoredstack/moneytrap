import type {
  AdjustmentRecord,
  AdvertiserRecord,
  ProgramRecord,
  SettlementEvidenceRecord,
  TransactionRecord,
  VerifiedNotification,
} from "@moneytrap/app/src/ports/network-connector";
import { type CapabilityProfile, CONNECTOR_OPERATIONS, Money } from "@moneytrap/domain";

// The fixture names in wave-04-network-eligibility.md §5.
export const FIXTURE_NAMES = [
  "clean-catalog",
  "commission-change",
  "malformed-records",
  "disabled-credential",
  "sync-interrupt",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

// A program as the upstream recorded it. A malformed entry is missing fields or carries unknown ones; the port type
// cannot express that, so the simulator passes it through and the catalog sync (WP-4.6) must validate it.
export type RecordedProgram = ProgramRecord | Partial<ProgramRecord>;

export interface RecordedFixture {
  name: FixtureName;
  // false makes every operation fail as not_authorized, as a disabled credential does upstream.
  credentialEnabled: boolean;
  capabilities: CapabilityProfile;
  // Maximum items per page for every cursor-paged operation.
  pageSize: number;
  // The freshness instant the upstream reports on every page.
  watermark: Date;
  // Fails the named operation once, when it reaches the page at this item offset. The next call succeeds.
  interruptOnce: { operation: "discover_programs"; atOffset: number } | null;
  advertisers: AdvertiserRecord[];
  programs: RecordedProgram[];
  transactions: TransactionRecord[];
  adjustments: AdjustmentRecord[];
  settlements: SettlementEvidenceRecord[];
  // A callback is verified by matching the x-sim-signature header; any other value is refused.
  notification: { signature: string; event: VerifiedNotification };
}

const WATERMARK = new Date("2026-10-01T00:00:00.000Z");
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
const usd = (minorUnits: number) => Money.of(BigInt(minorUnits), "USD");

const allSupported = Object.fromEntries(
  CONNECTOR_OPERATIONS.map((operation) => [operation, "supported"]),
) as CapabilityProfile;

const advertisers: AdvertiserRecord[] = [
  { sourceId: "adv-100", revision: "1", name: "Northwind Outdoor" },
  { sourceId: "adv-200", revision: "1", name: "Harbor Books" },
];

const prg1: ProgramRecord = {
  sourceId: "prg-1",
  revision: "1",
  advertiserSourceId: "adv-100",
  name: "Northwind Trail Gear",
  terms: "Commission 8% on net sales",
  eligibility: null,
  countries: ["US", "CA"],
  channels: ["website", "email"],
  approval: "approved",
};

const prg2: ProgramRecord = {
  sourceId: "prg-2",
  revision: "1",
  advertiserSourceId: "adv-200",
  name: "Harbor Books Reader",
  terms: "Flat fee per sale",
  eligibility: "Sites with book content only",
  countries: ["US"],
  channels: ["website"],
  approval: "pending",
};

const prg3: ProgramRecord = {
  sourceId: "prg-3",
  revision: "1",
  advertiserSourceId: "adv-200",
  name: "Harbor Books Kids",
  terms: "Commission 5% on net sales",
  eligibility: null,
  countries: ["GB"],
  channels: ["website"],
  approval: "rejected",
};

const programs: ProgramRecord[] = [prg1, prg2, prg3];

const transactions: TransactionRecord[] = [
  {
    sourceId: "txn-1",
    revision: "1",
    status: "approved",
    amount: usd(12_500),
    occurredAt: day(3),
    subId: "click-a",
  },
  {
    sourceId: "txn-2",
    revision: "1",
    status: "pending",
    amount: usd(4_200),
    occurredAt: day(5),
    subId: null,
  },
  {
    sourceId: "txn-3",
    revision: "1",
    status: "declined",
    amount: usd(9_900),
    occurredAt: day(7),
    subId: "click-b",
  },
];

const adjustments: AdjustmentRecord[] = [
  {
    sourceId: "adj-1",
    revision: "1",
    originalTransactionId: "txn-1",
    amount: usd(-2_500),
    occurredAt: day(9),
  },
];

const settlements: SettlementEvidenceRecord[] = [{ remittanceId: "rem-1", amount: usd(10_000), paidAt: day(10) }];

const notification = {
  signature: "sig-valid",
  event: { eventId: "evt-1", kind: "commission.updated", correlationId: "corr-1" },
};

const clean: RecordedFixture = {
  name: "clean-catalog",
  credentialEnabled: true,
  capabilities: allSupported,
  pageSize: 2,
  watermark: WATERMARK,
  interruptOnce: null,
  advertisers,
  programs,
  transactions,
  adjustments,
  settlements,
  notification,
};

/** Every fixture the simulator ships with, built from the clean catalog so each one differs in a single way. */
export const RECORDED_FIXTURES: Readonly<Record<FixtureName, RecordedFixture>> = {
  "clean-catalog": clean,
  "commission-change": {
    ...clean,
    name: "commission-change",
    // Same source identity as prg-1, new revision and changed commission text. The previous revision stays available.
    programs: [{ ...prg1, revision: "2", terms: "Commission 10% on net sales" }, prg2, prg3],
  },
  "malformed-records": {
    ...clean,
    name: "malformed-records",
    programs: [
      // Missing sourceId: must be quarantined, never created as a program.
      { revision: "1", advertiserSourceId: "adv-100", name: "No Identity", approval: "approved" },
      // Unknown payload field: the record is valid and the field is passed through for the sync to count.
      { ...prg1, sourceId: "prg-4", campaignTier: "gold" } as RecordedProgram,
      prg2,
    ],
  },
  "disabled-credential": {
    ...clean,
    name: "disabled-credential",
    credentialEnabled: false,
  },
  "sync-interrupt": {
    ...clean,
    name: "sync-interrupt",
    // One item per page, so adv-200 (two programs) has a second page. That page fails once; a resumed sync must
    // continue from the same cursor without repeating the first item.
    pageSize: 1,
    interruptOnce: { operation: "discover_programs", atOffset: 1 },
  },
};
