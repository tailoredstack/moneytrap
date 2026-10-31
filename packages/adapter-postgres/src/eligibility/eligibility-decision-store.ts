import { createHash } from "node:crypto";
import {
  type DenyReason,
  ELIGIBILITY_POLICY_VERSION,
  type EligibilityDecision,
  type EligibilityInput,
  evaluateEligibility,
  type RuleCheck,
} from "@moneytrap/domain";
import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import { withTx } from "../transaction";

// Eligibility decisions are persisted from the pure policy (WP-4.8, DM-024). The store runs evaluateEligibility itself, so
// every row is the policy's output for the inputs it stores. A repeat of the same inputs under the same policy version is
// a no-op and reports the existing row. A row is never updated, so an earlier decision is never overwritten.

export type DecisionOutcome = "allow" | "deny";

export interface EvaluationResult {
  decision: DecisionOutcome;
  reasons: DenyReason[];
  checks: RuleCheck[];
}

export interface StoredEligibilityDecision extends EvaluationResult {
  id: string;
  propertyId: string;
  programId: string;
  policyVersion: number;
  inputs: EligibilityInput;
  inputHash: string;
  evaluatedAt: Date;
}

export interface EligibilityDecisionWrite {
  // Platform IDs. The decision ID is used only when the evaluation is new; the audit ID only when a row is written.
  id: string;
  auditId: string;
  organizationId: string;
  propertyId: string;
  programId: string;
  input: EligibilityInput;
  actor: { type: string; id: string };
  occurredAt: Date;
}

export interface RecordedDecision {
  outcome: "recorded" | "existing";
  decision: StoredEligibilityDecision;
}

// reproduced: replaying the stored inputs under the stored policy gives the stored decision, reasons, and checks.
// mismatch: the replay differs, which means the stored facts or the policy changed without a version bump.
// policy_unavailable: the decision was made under a policy version this build does not carry.
export type ReplayOutcome = "reproduced" | "mismatch" | "policy_unavailable";

// Reads take the caller's organization, so a decision is only visible through its own tenant scope.
export interface EligibilityDecisionStore {
  record(write: EligibilityDecisionWrite): Promise<RecordedDecision>;
  find(organizationId: string, id: string): Promise<StoredEligibilityDecision | null>;
  listForPair(organizationId: string, propertyId: string, programId: string): Promise<StoredEligibilityDecision[]>;
  replay(organizationId: string, id: string): Promise<ReplayOutcome | null>;
}

interface DecisionRow {
  id: string;
  property_id: string;
  program_id: string;
  policy_version: number;
  decision: DecisionOutcome;
  reasons: DenyReason[];
  checks: RuleCheck[];
  inputs: EligibilityInput;
  input_hash: string;
  evaluated_at: Date;
}

function toDecision(row: DecisionRow): StoredEligibilityDecision {
  return {
    id: row.id,
    propertyId: row.property_id,
    programId: row.program_id,
    policyVersion: row.policy_version,
    decision: row.decision,
    reasons: row.reasons,
    checks: row.checks,
    inputs: row.inputs,
    inputHash: row.input_hash,
    evaluatedAt: row.evaluated_at,
  };
}

// The stored shape of the inputs. JSON round-trips drop undefined fields, so the policy runs on this copy and the stored
// facts reproduce exactly what was evaluated.
function storedShape(input: EligibilityInput): EligibilityInput {
  return JSON.parse(JSON.stringify(input)) as EligibilityInput;
}

function outcomeOf(evaluation: EligibilityDecision): EvaluationResult {
  if (evaluation.decision === "allow") return { decision: "allow", reasons: [], checks: [...evaluation.checks] };
  return { decision: "deny", reasons: [...evaluation.reasons], checks: [...evaluation.checks] };
}

// Keys are sorted at every level, so two equal values always serialise to the same text.
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

// The policy tests list fields with `some`, so their order never changes a decision. The hash sorts them, so the same set
// in another order is the same evaluation. The stored inputs keep the order they arrived in.
function hashEvaluation(policyVersion: number, inputs: EligibilityInput): string {
  const set = (values: unknown) => (Array.isArray(values) ? [...values].sort() : values);
  const keyed = {
    ...inputs,
    program: { ...inputs.program, countries: set(inputs.program?.countries), channels: set(inputs.program?.channels) },
    contract: {
      ...inputs.contract,
      countries: set(inputs.contract?.countries),
      channels: set(inputs.contract?.channels),
    },
  };
  return createHash("sha256")
    .update(canonicalJson({ policyVersion, inputs: keyed }))
    .digest("hex");
}

async function writeAudit(
  tx: Transaction<unknown>,
  write: EligibilityDecisionWrite,
  decision: StoredEligibilityDecision,
): Promise<void> {
  const metadata = {
    decision: decision.decision,
    reasons: decision.reasons,
    policyVersion: decision.policyVersion,
    propertyId: decision.propertyId,
    programId: decision.programId,
    inputHash: decision.inputHash,
  };
  await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
    values (${write.auditId}, ${write.organizationId}, ${write.actor.type}, ${write.actor.id}, 'eligibility_decided',
      'eligibility_decision', ${decision.id}, ${JSON.stringify(metadata)}::jsonb, ${write.occurredAt})`.execute(tx);
}

async function selectOne(
  db: Kysely<unknown> | Transaction<unknown>,
  where: RawBuilder<unknown>,
): Promise<StoredEligibilityDecision | null> {
  const result = await sql<DecisionRow>`select id, property_id, program_id, policy_version, decision, reasons, checks,
      inputs, input_hash, evaluated_at
    from eligibility_decisions where ${where}`.execute(db);
  const row = result.rows[0];
  return row ? toDecision(row) : null;
}

// Records a decision and its audit row in one transaction (TP-W3-006 pattern). If either write fails, neither commits.
// The insert is idempotent on (property, program, policy version, input hash), so the same inputs add no second row.
export function createEligibilityDecisionStore(db: Kysely<unknown>): EligibilityDecisionStore {
  return {
    async record(write) {
      const inputs = storedShape(write.input);
      const evaluation = evaluateEligibility(inputs);
      const result = outcomeOf(evaluation);
      const inputHash = hashEvaluation(evaluation.policyVersion, inputs);

      return withTx(db, async (tx) => {
        // The property must belong to the organization the decision is written for. Foreign keys check only existence.
        const owned = await sql`select 1 from properties where id = ${write.propertyId}
          and organization_id = ${write.organizationId}`.execute(tx);
        if (owned.rows.length === 0) throw new Error("eligibility: property is not in the organization");

        const inserted = await sql<DecisionRow>`insert into eligibility_decisions
          (id, organization_id, property_id, program_id, policy_version, decision, reasons, checks, inputs, input_hash,
            evaluated_at)
          values (${write.id}, ${write.organizationId}, ${write.propertyId}, ${write.programId},
            ${evaluation.policyVersion}, ${result.decision}, ${JSON.stringify(result.reasons)}::jsonb,
            ${JSON.stringify(result.checks)}::jsonb, ${JSON.stringify(inputs)}::jsonb, ${inputHash}, ${write.occurredAt})
          on conflict (property_id, program_id, policy_version, input_hash) do nothing
          returning id, property_id, program_id, policy_version, decision, reasons, checks, inputs, input_hash, evaluated_at`.execute(
          tx,
        );

        const created = inserted.rows[0];
        if (created) {
          const decision = toDecision(created);
          await writeAudit(tx, write, decision);
          return { outcome: "recorded", decision };
        }

        const existing = await selectOne(
          tx,
          sql`property_id = ${write.propertyId} and program_id = ${write.programId}
            and policy_version = ${evaluation.policyVersion} and input_hash = ${inputHash}`,
        );
        if (!existing) throw new Error("eligibility: conflicting decision row missing after insert");
        return { outcome: "existing", decision: existing };
      });
    },

    async find(organizationId, id) {
      return selectOne(db, sql`organization_id = ${organizationId} and id = ${id}`);
    },

    async listForPair(organizationId, propertyId, programId) {
      const result =
        await sql<DecisionRow>`select id, property_id, program_id, policy_version, decision, reasons, checks,
          inputs, input_hash, evaluated_at
        from eligibility_decisions
        where organization_id = ${organizationId} and property_id = ${propertyId} and program_id = ${programId}
        order by evaluated_at, policy_version, id`.execute(db);
      return result.rows.map(toDecision);
    },

    async replay(organizationId, id) {
      const stored = await selectOne(db, sql`organization_id = ${organizationId} and id = ${id}`);
      if (!stored) return null;
      if (stored.policyVersion !== ELIGIBILITY_POLICY_VERSION) return "policy_unavailable";

      const replayed = outcomeOf(evaluateEligibility(stored.inputs));
      const same =
        canonicalJson(replayed) ===
        canonicalJson({ decision: stored.decision, reasons: stored.reasons, checks: stored.checks });
      return same ? "reproduced" : "mismatch";
    },
  };
}
