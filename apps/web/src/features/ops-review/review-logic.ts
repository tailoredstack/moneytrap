// Pure rules behind the ops review queue (UI-017, UI-018, UI-023, UI-024). The screens and the API client stay out of
// this file, so the rules are tested without rendering.

export const QUEUE_PAGE_SIZE = 25;

// KYB items are publisher reviews (UC06); property items are compliance reviews (UC08).
export interface QueueItem {
  id: string;
  type: "property" | "kyb";
  label: string;
  // ISO time the item entered review. The queue shows the longest wait first.
  waitingSince: string;
}

export interface QueuePage {
  rows: QueueItem[];
  page: number;
  pageCount: number;
  total: number;
  // The 1-based range of rows on this page, or 0 and 0 when the queue is empty.
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

// Waiting time first, then id, so two reloads of the same queue show the same order (TP-W3-023).
function byWaitingThenId(a: QueueItem, b: QueueItem): number {
  const waiting = Date.parse(a.waitingSince) - Date.parse(b.waitingSince);
  if (waiting !== 0) return waiting;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// A page past the end clamps to the last page, so a queue that shrank under the reviewer still shows rows.
export function pageQueue(items: QueueItem[], requestedPage: number): QueuePage {
  const sorted = [...items].sort(byWaitingThenId);
  const pageCount = Math.max(1, Math.ceil(sorted.length / QUEUE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), pageCount);
  const start = (page - 1) * QUEUE_PAGE_SIZE;
  const rows = sorted.slice(start, start + QUEUE_PAGE_SIZE);
  const from = rows.length > 0 ? start + 1 : 0;
  const to = rows.length > 0 ? start + rows.length : 0;
  return {
    rows,
    page,
    pageCount,
    total: sorted.length,
    from,
    to,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}

// Every item in the queue is pending review, so the filter narrows by type and by name instead of by status.
export interface QueueFilter {
  type: "all" | QueueItem["type"];
  search: string;
}

export const NO_QUEUE_FILTER: QueueFilter = { type: "all", search: "" };

export function isFiltered(filter: QueueFilter): boolean {
  return filter.type !== "all" || filter.search.trim() !== "";
}

// Applied before paging, so the count and the page range describe the filtered list.
export function filterQueue(items: QueueItem[], filter: QueueFilter): QueueItem[] {
  const term = filter.search.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.type !== "all" && item.type !== filter.type) return false;
    return term === "" || item.label.toLowerCase().includes(term);
  });
}

// Hours under a day, then days. The queue is a triage list, so the exact minute does not matter.
export function formatWaiting(waitingSince: string, now: Date): string {
  const hours = Math.floor((now.getTime() - Date.parse(waitingSince)) / 3_600_000);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export type DecisionVerdict = "approve" | "reject";

export interface DecisionErrors {
  decision?: string;
  reason?: string;
}

export type DecisionValidation =
  | { ok: true; value: { decision: DecisionVerdict; reason: string } }
  | { ok: false; errors: DecisionErrors };

// A decision needs a verdict and a non-blank reason (TP-W3-005, TP-W3-024). The reason is trimmed before it is sent.
export function validateDecision(input: { decision: string | null; reason: string }): DecisionValidation {
  const reason = input.reason.trim();
  const errors: DecisionErrors = {};
  if (input.decision !== "approve" && input.decision !== "reject") {
    errors.decision = "Choose approve or reject.";
  }
  if (reason === "") errors.reason = "Enter a reason for this decision.";
  if (errors.decision !== undefined || errors.reason !== undefined) return { ok: false, errors };
  return { ok: true, value: { decision: input.decision as DecisionVerdict, reason } };
}

// The shape the review API answers with (see DecideReviewResult in the app package).
export type DecisionReply =
  | { ok: true; value: { status: "approved" | "rejected" } }
  | { ok: false; code: "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string };

export interface DecisionClient {
  decide(id: string, body: { decision: DecisionVerdict; reason: string }): Promise<DecisionReply>;
}

export type SubmitOutcome =
  | { kind: "decided"; status: "approved" | "rejected" }
  | { kind: "invalid"; errors: DecisionErrors }
  | { kind: "conflict" }
  | { kind: "not-found" }
  | { kind: "failed" };

// An invalid form never reaches the API. A conflict means someone else decided first, so the reviewer reloads the item.
export async function submitDecision(
  client: DecisionClient,
  id: string,
  input: { decision: string | null; reason: string },
): Promise<SubmitOutcome> {
  const validation = validateDecision(input);
  if (!validation.ok) return { kind: "invalid", errors: validation.errors };

  const reply = await client.decide(id, validation.value);
  if (reply.ok) return { kind: "decided", status: reply.value.status };
  if (reply.code === "STATE_CONFLICT") return { kind: "conflict" };
  if (reply.code === "RESOURCE_NOT_FOUND") return { kind: "not-found" };
  return { kind: "failed" };
}

export interface EvidenceItem {
  id: string;
  // A check is a verification result, a lookup is a third-party record, and a document is an uploaded file.
  kind: "check" | "lookup" | "document";
  label: string;
}

// Documents are shown only to reviewers allowed to see them (TP-W3-025). The server rejects a direct fetch too.
export function visibleEvidence(items: EvidenceItem[], access: { canViewDocuments: boolean }): EvidenceItem[] {
  if (access.canViewDocuments) return items;
  return items.filter((item) => item.kind !== "document");
}
