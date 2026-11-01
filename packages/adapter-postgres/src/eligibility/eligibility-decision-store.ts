import { createHash } from "node:crypto";
import {
  type DenyReason,
  ELIGIBILITY_POLICY_VERSION,
  type EligibilityDecision,
  type EligibilityInput,
  evaluateEligibility,
  type ProgramFactPayload,
  type RuleCheck,
} from "@moneytrap/domain";
import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import { withTx } from "../transaction";

// Eligibility decisions are persisted from the pure policy (WP-4.8, DM-024). The store runs evaluateEligibility itself, so
// every row is the policy's output for the inputs it stores. A repeat of the same inputs and revision under the same
// policy version is a no-op and reports the existing row. A row is never updated, so an earlier decision is never
// overwritten.

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
  // The catalog revision the program facts were read from, or null when the program had none.
  programRevisionSeq: number | null;
  sourceRevision: string | null;
}

export interface EligibilityDecisionWrite {
  // Platform IDs. The decision ID is used only when the evaluation is new; the audit ID only when a row is written.
  id: string;
  auditId: string;
  organizationId: string;
  propertyId: string;
  programId: string;
  // The program facts are not supplied by the caller. They are read from the program's latest stored source revision,
  // inside the same transaction, so the decision rests on what the catalog actually holds.
  input: Omit<EligibilityInput, "program">;
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

/** Test seam for exercising persisted versions before the corresponding domain policy ships. */
export interface EligibilityPolicyVersions {
  currentVersion: number;
  evaluate: typeof evaluateEligibility;
  replay: ReadonlyMap<number, typeof evaluateEligibility>;
}

const CURRENT_POLICY_VERSIONS: EligibilityPolicyVersions = {
  currentVersion: ELIGIBILITY_POLICY_VERSION,
  evaluate: evaluateEligibility,
  replay: new Map([[ELIGIBILITY_POLICY_VERSION, evaluateEligibility]]),
};

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
  program_revision_seq: number | null;
  source_revision: string | null;
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
    programRevisionSeq: row.program_revision_seq,
    sourceRevision: row.source_revision,
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
// Country codes and channel names compare without case or surrounding space (see the policy's normalise), so the hash
// does the same. Duplicates are dropped for the same reason: the policy only asks whether a value is listed.
function hashEvaluation(
  policyVersion: number,
  inputs: EligibilityInput,
  revision: { seq: number | null; source: string | null },
): string {
  const text = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : value);
  const set = (values: unknown) => (Array.isArray(values) ? [...new Set(values.map(text))].sort() : values);
  const keyed = {
    ...inputs,
    geography: text(inputs.geography),
    channel: text(inputs.channel),
    program: { ...inputs.program, countries: set(inputs.program?.countries), channels: set(inputs.program?.channels) },
    contract: {
      ...inputs.contract,
      countries: set(inputs.contract?.countries),
      channels: set(inputs.contract?.channels),
    },
  };
  return createHash("sha256")
    .update(canonicalJson({ policyVersion, inputs: keyed, revision }))
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
      inputs, input_hash, evaluated_at, program_revision_seq, source_revision
    from eligibility_decisions where ${where}`.execute(db);
  const row = result.rows[0];
  return row ? toDecision(row) : null;
}

// Appends one evaluation row for every run of the policy, including a repeat that reuses a stored decision. The link gate
// reads the latest of these, so a repeat that reaches a different outcome is never hidden behind an older row.
async function writeEvaluation(
  tx: Transaction<unknown>,
  write: EligibilityDecisionWrite,
  decisionId: string,
): Promise<void> {
  await sql`insert into eligibility_evaluations (organization_id, property_id, program_id, decision_id, evaluated_at)
    values (${write.organizationId}, ${write.propertyId}, ${write.programId}, ${decisionId}, ${write.occurredAt})`.execute(
    tx,
  );
}

// Records a decision and its audit row in one transaction (TP-W3-006 pattern). If either write fails, neither commits.
// The insert is idempotent on (property, program, policy version, input hash). The hash covers the revision too, so the
// same inputs read from a later revision add a row that names that revision.
export function createEligibilityDecisionStore(
  db: Kysely<unknown>,
  policies: EligibilityPolicyVersions = CURRENT_POLICY_VERSIONS,
): EligibilityDecisionStore {
  return {
    async record(write) {
      return withTx(db, async (tx) => {
        // The property must belong to the organization the decision is written for. Foreign keys check only existence.
        // FOR NO KEY UPDATE conflicts with the FOR SHARE that a link write takes, so a deny decision waits for an
        // in-flight link write and a link write waits for an in-flight decision (WP-5.13).
        const owned = await sql`select 1 from properties where id = ${write.propertyId}
          and organization_id = ${write.organizationId} for no key update`.execute(tx);
        if (owned.rows.length === 0) throw new Error("eligibility: property is not in the organization");

        // Program facts come from the latest stored revision. A program with no revision has unknown approval, so the
        // policy denies it rather than reading a gap as allow.
        const facts = await sql<{
          revision_seq: number;
          source_revision: string;
          payload: ProgramFactPayload;
        }>`select r.revision_seq, r.source_revision, r.payload from programs p
          join program_revisions r on r.program_id = p.id and r.revision_seq = p.current_revision_seq
          where p.id = ${write.programId}`.execute(tx);
        const fact = facts.rows[0];
        const payload = fact?.payload;
        const revisionSeq = fact?.revision_seq ?? null;
        const sourceRevision = fact?.source_revision ?? null;
        const inputs = storedShape({
          ...write.input,
          program: {
            approval: payload?.approval ?? null,
            countries: payload?.countries ?? [],
            channels: payload?.channels ?? [],
          },
        });
        const evaluation = policies.evaluate(inputs);
        if (evaluation.policyVersion !== policies.currentVersion)
          throw new Error("eligibility: evaluator returned a different policy version than configured");
        const result = outcomeOf(evaluation);
        const inputHash = hashEvaluation(evaluation.policyVersion, inputs, {
          seq: revisionSeq,
          source: sourceRevision,
        });

        const inserted = await sql<DecisionRow>`insert into eligibility_decisions
          (id, organization_id, property_id, program_id, policy_version, decision, reasons, checks, inputs, input_hash,
            evaluated_at, program_revision_seq, source_revision)
          values (${write.id}, ${write.organizationId}, ${write.propertyId}, ${write.programId},
            ${evaluation.policyVersion}, ${result.decision}, ${JSON.stringify(result.reasons)}::jsonb,
            ${JSON.stringify(result.checks)}::jsonb, ${JSON.stringify(inputs)}::jsonb, ${inputHash}, ${write.occurredAt}, ${revisionSeq}, ${sourceRevision})
          on conflict (property_id, program_id, policy_version, input_hash) do nothing
          returning id, property_id, program_id, policy_version, decision, reasons, checks, inputs, input_hash, evaluated_at, program_revision_seq, source_revision`.execute(
          tx,
        );

        const created = inserted.rows[0];
        if (created) {
          const decision = toDecision(created);
          await writeEvaluation(tx, write, decision.id);
          await writeAudit(tx, write, decision);
          return { outcome: "recorded", decision };
        }

        const existing = await selectOne(
          tx,
          sql`property_id = ${write.propertyId} and program_id = ${write.programId}
            and policy_version = ${evaluation.policyVersion} and input_hash = ${inputHash}`,
        );
        if (!existing) throw new Error("eligibility: conflicting decision row missing after insert");
        await writeEvaluation(tx, write, existing.id);
        return { outcome: "existing", decision: existing };
      });
    },

    async find(organizationId, id) {
      return selectOne(db, sql`organization_id = ${organizationId} and id = ${id}`);
    },

    async listForPair(organizationId, propertyId, programId) {
      const result =
        await sql<DecisionRow>`select id, property_id, program_id, policy_version, decision, reasons, checks,
          inputs, input_hash, evaluated_at, program_revision_seq, source_revision
        from eligibility_decisions
        where organization_id = ${organizationId} and property_id = ${propertyId} and program_id = ${programId}
        order by evaluated_at, policy_version, id`.execute(db);
      return result.rows.map(toDecision);
    },

    async replay(organizationId, id) {
      const stored = await selectOne(db, sql`organization_id = ${organizationId} and id = ${id}`);
      if (!stored) return null;
      const evaluate = policies.replay.get(stored.policyVersion);
      if (!evaluate) return "policy_unavailable";
      const replayedEvaluation = evaluate(stored.inputs);
      if (replayedEvaluation.policyVersion !== stored.policyVersion) return "mismatch";

      // A row whose inputs no longer hash to its stored key was altered after it was written.
      if (
        hashEvaluation(stored.policyVersion, stored.inputs, {
          seq: stored.programRevisionSeq,
          source: stored.sourceRevision,
        }) !== stored.inputHash
      )
        return "mismatch";

      const replayed = outcomeOf(replayedEvaluation);
      const same =
        canonicalJson(replayed) ===
        canonicalJson({ decision: stored.decision, reasons: stored.reasons, checks: stored.checks });
      return same ? "reproduced" : "mismatch";
    },
  };
}
