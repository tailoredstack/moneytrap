import {
  Button,
  Form,
  FormLabel,
  FormMessage,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@moneytrap/ui";
import { type FormEvent, useEffect, useRef } from "react";
import {
  type DecisionErrors,
  type EvidenceItem,
  formatWaiting,
  type QueueItem,
  type QueuePage,
  visibleEvidence,
} from "./review-logic";

const typeLabel: Record<QueueItem["type"], string> = { property: "Property", kyb: "KYB" };

// UI-017, UI-023. The count always shows the whole queue, not just the page (TP-W3-023).
export function QueueView({
  page,
  onPageChange,
  onReview,
  now = new Date(),
}: {
  page: QueuePage;
  onPageChange: (page: number) => void;
  onReview: (id: string) => void;
  now?: Date;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Review queue</h1>
      {page.total === 0 ? <p className="text-sm">Nothing is waiting for review.</p> : null}
      {page.total > 0 ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{typeLabel[row.type]}</TableCell>
                  <TableCell>{formatWaiting(row.waitingSince, now)}</TableCell>
                  <TableCell>
                    <Button type="button" variant="outline" size="sm" onClick={() => onReview(row.id)}>
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between text-sm">
            <p>{`Showing ${page.from}–${page.to} of ${page.total}`}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!page.hasPrevious}
                onClick={() => onPageChange(page.page - 1)}
              >
                Prev
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!page.hasNext}
                onClick={() => onPageChange(page.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

// UI-018, UI-024. The evidence panel and the decision form sit side by side. A reason error moves focus to the field.
export function DecisionView({
  item,
  evidence,
  canViewDocuments,
  submitting,
  errors,
  notice,
  onSubmit,
}: {
  item: QueueItem;
  evidence: EvidenceItem[];
  canViewDocuments: boolean;
  submitting: boolean;
  errors?: DecisionErrors;
  // A message about the whole decision, such as a conflict, that is not tied to one field.
  notice?: string;
  onSubmit: (input: { decision: string | null; reason: string }) => void;
}) {
  const reasonRef = useRef<HTMLInputElement>(null);
  const reasonError = errors?.reason;
  useEffect(() => {
    if (reasonError !== undefined) reasonRef.current?.focus();
  }, [reasonError]);

  const shown = visibleEvidence(evidence, { canViewDocuments });
  const documentsHidden = shown.length < evidence.length;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const decision = data.get("decision");
    onSubmit({ decision: typeof decision === "string" ? decision : null, reason: String(data.get("reason") ?? "") });
  };

  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{item.label}</h1>
        <h2 className="text-base font-medium">Evidence</h2>
        <ul className="list-disc pl-5 text-sm">
          {shown.map((entry) => (
            <li key={entry.id}>{entry.label}</li>
          ))}
        </ul>
        {documentsHidden ? <p className="text-sm">Documents: restricted, not shown.</p> : null}
      </div>
      <Form onSubmit={handleSubmit} className="rounded-md border p-4">
        <h2 className="text-base font-medium">Decision</h2>
        <fieldset className="space-y-2">
          <legend className="sr-only">Decision</legend>
          <div className="flex items-center gap-2">
            <input id="decision-approve" type="radio" name="decision" value="approve" />
            <FormLabel htmlFor="decision-approve">Approve</FormLabel>
          </div>
          <div className="flex items-center gap-2">
            <input id="decision-reject" type="radio" name="decision" value="reject" />
            <FormLabel htmlFor="decision-reject">Reject</FormLabel>
          </div>
          <FormMessage>{errors?.decision}</FormMessage>
        </fieldset>
        <div className="space-y-1">
          <FormLabel htmlFor="decision-reason">Reason*</FormLabel>
          <Input
            id="decision-reason"
            name="reason"
            ref={reasonRef}
            aria-invalid={reasonError !== undefined ? "true" : undefined}
            aria-describedby={reasonError !== undefined ? "decision-reason-error" : undefined}
          />
          <FormMessage id="decision-reason-error">{reasonError}</FormMessage>
        </div>
        <FormMessage>{notice}</FormMessage>
        <Button type="submit" disabled={submitting}>
          Submit
        </Button>
      </Form>
    </section>
  );
}
