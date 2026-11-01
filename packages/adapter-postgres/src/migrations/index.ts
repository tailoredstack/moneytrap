import type { Migration, MigrationProvider } from "kysely/migration";
import { platform } from "./0001_platform";
import { platformAuditGuard } from "./0001_platform_audit_guard";
import { betterAuth } from "./0002_better_auth";
import { identity } from "./0003_identity";
import { organization } from "./0003_organization";
import { catalog } from "./0004_catalog";
import { publisher } from "./0004_publisher";
import { publisherOrganization } from "./0005_publisher_organization";
import { properties } from "./0006_properties";
import { ledger } from "./0007_ledger";
import { networks } from "./0008_networks";
import { catalogSync } from "./0009_catalog_sync";
import { eligibility } from "./0010_eligibility";
import { programApprovals } from "./0011_program_approvals";
import { clicks } from "./0012_clicks";
import { riskFlags } from "./0013_risk_flags";
import { links } from "./0014_links";
import { eligibilityEvaluations } from "./0015_eligibility_evaluations";
import { linkBulkJobs } from "./0016_link_bulk_jobs";
import { clicksRecorded } from "./0017_clicks_recorded";
import { conversions } from "./0018_conversions";
import { statements } from "./0019_statements";
import { settlementReceipts } from "./0020_settlement_receipts";
import { payoutMethods } from "./0021_payout_methods";
import { payoutPolicy } from "./0022_payout_policy";
import { payoutBatches } from "./0023_payout_batches";

// Every migration is imported here statically so the compiled binary carries the set and
// reads no files at runtime (ADR-003). Add new entries in filename order.
const migrations: Record<string, Migration> = {
  "0001_platform": platform,
  "0001_platform_audit_guard": platformAuditGuard,
  "0002_better_auth": betterAuth,
  "0003_identity": identity,
  "0003_organization": organization,
  "0004_catalog": catalog,
  "0004_publisher": publisher,
  "0005_publisher_organization": publisherOrganization,
  "0006_properties": properties,
  "0007_ledger": ledger,
  "0008_networks": networks,
  "0009_catalog_sync": catalogSync,
  "0010_eligibility": eligibility,
  "0011_program_approvals": programApprovals,
  "0012_clicks": clicks,
  "0013_risk_flags": riskFlags,
  "0014_links": links,
  "0015_eligibility_evaluations": eligibilityEvaluations,
  "0016_link_bulk_jobs": linkBulkJobs,
  "0017_clicks_recorded": clicksRecorded,
  "0018_conversions": conversions,
  "0019_statements": statements,
  "0020_settlement_receipts": settlementReceipts,
  "0021_payout_methods": payoutMethods,
  "0022_payout_policy": payoutPolicy,
  "0023_payout_batches": payoutBatches,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
