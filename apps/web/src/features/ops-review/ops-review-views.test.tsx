import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionView, QueueView } from "./ops-review-views";
import { pageQueue, type QueueItem } from "./review-logic";

function queueOf(count: number): QueueItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${String(index).padStart(2, "0")}`,
    type: index % 2 === 0 ? "property" : "kyb",
    label: `Item ${index}`,
    waitingSince: new Date(Date.UTC(2026, 9, 1) + index * 60_000).toISOString(),
  }));
}

describe("QueueView (UI-017, UI-023, TP-W3-023)", () => {
  test("shows one page of rows and the count of the whole queue", () => {
    const html = renderToStaticMarkup(
      <QueueView page={pageQueue(queueOf(50), 1)} onPageChange={() => {}} onReview={() => {}} />,
    );
    expect(html).toContain("Showing 1–25 of 50");
    expect(html).toContain(">Item 0<");
    expect(html).toContain(">Item 24<");
    expect(html).not.toContain(">Item 25<");
  });

  test("Prev is disabled on the first page and Next moves on", () => {
    const html = renderToStaticMarkup(
      <QueueView page={pageQueue(queueOf(50), 1)} onPageChange={() => {}} onReview={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Prev<\/button>/);
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Next<\/button>/);
  });

  test("an empty queue says so instead of drawing an empty table", () => {
    const html = renderToStaticMarkup(
      <QueueView page={pageQueue([], 1)} onPageChange={() => {}} onReview={() => {}} />,
    );
    expect(html).toContain("Nothing is waiting for review.");
    expect(html).not.toContain("<tbody");
  });
});

describe("DecisionView (UI-018, UI-024, TP-W3-024)", () => {
  const item = queueOf(1)[0] as QueueItem;

  test("offers approve and reject with a reason field", () => {
    const html = renderToStaticMarkup(
      <DecisionView item={item} evidence={[]} canViewDocuments={false} submitting={false} onSubmit={() => {}} />,
    );
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain('for="decision-reason"');
    expect(html).toContain("Reason*");
  });

  test("an empty-reason error is announced and marks the field invalid", () => {
    const html = renderToStaticMarkup(
      <DecisionView
        item={item}
        evidence={[]}
        canViewDocuments={false}
        submitting={false}
        errors={{ reason: "Enter a reason for this decision." }}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Enter a reason for this decision.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="decision-reason-error"');
  });

  test("the submit button is disabled while the decision is sent", () => {
    const html = renderToStaticMarkup(
      <DecisionView item={item} evidence={[]} canViewDocuments={false} submitting onSubmit={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Submit<\/button>/);
  });

  test("a conflict tells the reviewer the item changed", () => {
    const html = renderToStaticMarkup(
      <DecisionView
        item={item}
        evidence={[]}
        canViewDocuments={false}
        submitting={false}
        notice="This item changed after you opened it. Reload to see its current state."
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain("Reload to see its current state.");
  });
});

describe("DecisionView evidence panel (UI-024, TP-W3-025)", () => {
  const item = queueOf(1)[0] as QueueItem;
  const evidence = [
    { id: "e1", kind: "check" as const, label: "DNS challenge: verified 10:02" },
    { id: "e2", kind: "document" as const, label: "Company registration" },
  ];

  test("a reviewer without document access sees the restricted note, not the document", () => {
    const html = renderToStaticMarkup(
      <DecisionView item={item} evidence={evidence} canViewDocuments={false} submitting={false} onSubmit={() => {}} />,
    );
    expect(html).toContain("DNS challenge: verified 10:02");
    expect(html).not.toContain("Company registration");
    expect(html).toContain("Documents: restricted, not shown.");
  });

  test("a reviewer with document access sees the document", () => {
    const html = renderToStaticMarkup(
      <DecisionView item={item} evidence={evidence} canViewDocuments submitting={false} onSubmit={() => {}} />,
    );
    expect(html).toContain("Company registration");
    expect(html).not.toContain("Documents: restricted, not shown.");
  });
});
