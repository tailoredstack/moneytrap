import { describe, expect, test } from "bun:test";
import {
  type DecisionClient,
  type EvidenceItem,
  filterQueue,
  formatWaiting,
  NO_QUEUE_FILTER,
  pageQueue,
  QUEUE_PAGE_SIZE,
  type QueueItem,
  submitDecision,
  validateDecision,
  visibleEvidence,
} from "./review-logic";

function queueOf(count: number): QueueItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${String(index).padStart(2, "0")}`,
    type: index % 2 === 0 ? "property" : "kyb",
    label: `Item ${index}`,
    // Earlier items were waiting longer, so the queue shows them first.
    waitingSince: new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + index * 60_000).toISOString(),
  }));
}

describe("pageQueue (TP-W3-023)", () => {
  test("a 50-item queue is paged 25 at a time with the count shown", () => {
    const page = pageQueue(queueOf(50), 1);
    expect(QUEUE_PAGE_SIZE).toBe(25);
    expect(page.rows).toHaveLength(25);
    expect(page.total).toBe(50);
    expect(page.from).toBe(1);
    expect(page.to).toBe(25);
    expect(page.pageCount).toBe(2);
    expect(page.hasPrevious).toBe(false);
    expect(page.hasNext).toBe(true);
  });

  test("the second page holds the rest and the count moves with it", () => {
    const page = pageQueue(queueOf(50), 2);
    expect(page.rows.map((row) => row.id)[0]).toBe("item-25");
    expect(page.rows).toHaveLength(25);
    expect(page.from).toBe(26);
    expect(page.to).toBe(50);
    expect(page.hasNext).toBe(false);
    expect(page.hasPrevious).toBe(true);
  });

  test("the order is stable: waiting time first, then id, whatever the input order", () => {
    const shuffled = [...queueOf(50)].reverse();
    const first = pageQueue(queueOf(50), 1).rows.map((row) => row.id);
    const again = pageQueue(shuffled, 1).rows.map((row) => row.id);
    expect(again).toEqual(first);
    expect(first[0]).toBe("item-00");
  });

  test("a page past the end clamps to the last page", () => {
    const page = pageQueue(queueOf(50), 9);
    expect(page.page).toBe(2);
    expect(page.rows[0]?.id).toBe("item-25");
  });

  test("an empty queue has no pages and no range", () => {
    const page = pageQueue([], 1);
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
    expect(page.pageCount).toBe(1);
    expect(page.from).toBe(0);
    expect(page.to).toBe(0);
  });
});

describe("filterQueue (UI-017, UI-023)", () => {
  test("no filter keeps every item", () => {
    expect(filterQueue(queueOf(50), NO_QUEUE_FILTER)).toHaveLength(50);
  });

  test("a type filter keeps only that type, and the paged count follows it", () => {
    const kyb = filterQueue(queueOf(50), { type: "kyb", search: "" });
    expect(kyb).toHaveLength(25);
    expect(pageQueue(kyb, 1).total).toBe(25);
    expect(kyb.every((item) => item.type === "kyb")).toBe(true);
  });

  test("a search matches part of the item label, ignoring case and surrounding spaces", () => {
    const found = filterQueue(queueOf(50), { type: "all", search: "  ITEM 4" });
    expect(found.map((item) => item.label)).toEqual([
      "Item 4",
      "Item 40",
      "Item 41",
      "Item 42",
      "Item 43",
      "Item 44",
      "Item 45",
      "Item 46",
      "Item 47",
      "Item 48",
      "Item 49",
    ]);
  });

  test("a search with no match returns an empty list", () => {
    expect(filterQueue(queueOf(50), { type: "all", search: "zzz" })).toEqual([]);
  });
});

describe("formatWaiting", () => {
  test("shows hours under a day and days after", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    expect(formatWaiting("2026-10-31T07:00:00Z", now)).toBe("5 h");
    expect(formatWaiting("2026-10-29T12:00:00Z", now)).toBe("2 d");
  });
});

describe("validateDecision (TP-W3-024)", () => {
  test("an empty reason is a field error on reason", () => {
    const result = validateDecision({ decision: "approve", reason: "" });
    expect(result).toEqual({ ok: false, errors: { reason: "Enter a reason for this decision." } });
  });

  test("a blank reason is the same error as an empty one", () => {
    const result = validateDecision({ decision: "reject", reason: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.reason).toBe("Enter a reason for this decision.");
  });

  test("a decision is required", () => {
    const result = validateDecision({ decision: null, reason: "DNS ok" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.decision).toBe("Choose approve or reject.");
  });

  test("a complete decision returns the trimmed reason", () => {
    expect(validateDecision({ decision: "approve", reason: "  DNS ok  " })).toEqual({
      ok: true,
      value: { decision: "approve", reason: "DNS ok" },
    });
  });
});

describe("submitDecision (TP-W3-024)", () => {
  function clientReplying(reply: Awaited<ReturnType<DecisionClient["decide"]>>) {
    const calls: Array<{ id: string; body: unknown }> = [];
    const client: DecisionClient = {
      decide: async (id, body) => {
        calls.push({ id, body });
        return reply;
      },
    };
    return { client, calls };
  }

  test("an empty reason never reaches the API", async () => {
    const { client, calls } = clientReplying({ ok: true, value: { status: "approved" } });
    const outcome = await submitDecision(client, "item-01", { decision: "approve", reason: "" });
    expect(outcome.kind).toBe("invalid");
    expect(calls).toHaveLength(0);
  });

  test("a valid decision is sent with the trimmed reason", async () => {
    const { client, calls } = clientReplying({ ok: true, value: { status: "rejected" } });
    const outcome = await submitDecision(client, "item-01", { decision: "reject", reason: " not owned " });
    expect(outcome).toEqual({ kind: "decided", status: "rejected" });
    expect(calls).toEqual([{ id: "item-01", body: { decision: "reject", reason: "not owned" } }]);
  });

  test("a state conflict tells the reviewer to reload the item", async () => {
    const { client } = clientReplying({ ok: false, code: "STATE_CONFLICT" });
    expect(await submitDecision(client, "item-01", { decision: "approve", reason: "ok" })).toEqual({
      kind: "conflict",
    });
  });

  test("a missing item is reported as not found", async () => {
    const { client } = clientReplying({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(await submitDecision(client, "item-01", { decision: "approve", reason: "ok" })).toEqual({
      kind: "not-found",
    });
  });
});

describe("visibleEvidence (TP-W3-025)", () => {
  const evidence: EvidenceItem[] = [
    { id: "e1", kind: "check", label: "DNS challenge: verified 10:02" },
    { id: "e2", kind: "lookup", label: "Domain WHOIS" },
    { id: "e3", kind: "document", label: "Company registration" },
  ];

  test("a reviewer without document access sees no document entries", () => {
    const visible = visibleEvidence(evidence, { canViewDocuments: false });
    expect(visible.map((item) => item.id)).toEqual(["e1", "e2"]);
  });

  test("a reviewer with document access sees every entry in order", () => {
    const visible = visibleEvidence(evidence, { canViewDocuments: true });
    expect(visible.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
  });
});
