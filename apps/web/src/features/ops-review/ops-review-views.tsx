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
  isFiltered,
  type QueueFilter,
  type QueueItem,
  type QueuePage,
  visibleEvidence,
} from "./review-logic";

const typeLabel: Record<QueueItem["type"], string> = { property: "Property", kyb: "KYB" };

// UI-017, UI-023. The count always shows the filtered queue (TP-W3-023). The parent resets the page to 1 when the
// filter changes.
export function QueueView({
  page,
  filter,
  onFilterChange,
  onPageChange,
  onReview,
  now = new Date(),
}: {
  page: QueuePage;
  filter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  onPageChange: (page: number) => void;
  onReview: (id: string) => void;
  now?: Date;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Review queue</h1>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <FormLabel htmlFor="queue-type">Type</FormLabel>
          <select
            id="queue-type"
            className="h-9 rounded-md border px-3 text-sm"
            value={filter.type}
            onChange={(event) => onFilterChange({ ...filter, type: event.currentTarget.value as QueueFilter["type"] })}
          >
            <option value="all">All</option>
            <option value="property">Property</option>
            <option value="kyb">KYB</option>
          </select>
        </div>
        <div className="space-y-1">
          <FormLabel htmlFor="queue-search">Search</FormLabel>
          <Input
            id="queue-search"
            type="search"
            value={filter.search}
            onChange={(event) => onFilterChange({ ...filter, search: event.currentTarget.value })}
          />
        </div>
      </div>
      {page.total === 0 ? (
        <p className="text-sm">
          {isFiltered(filter) ? "No items match these filters." : "Nothing is waiting for review."}
        </p>
      ) : null}
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Review ${row.label}`}
                      onClick={() => onReview(row.id)}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between text-sm">
            <p role="status">{`Showing ${page.from}–${page.to} of ${page.total}`}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous page"
                disabled={!page.hasPrevious}
                onClick={() => onPageChange(page.page - 1)}
              >
                Prev
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next page"
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
  // Pass a new errors object for each rejected submission. Focus moves to the reason field whenever that object
  // changes, so a repeated blank submit moves focus again even though the message text is the same.
  errors?: DecisionErrors | undefined;
  // A message about the whole decision, such as a conflict, that is not tied to one field.
  notice?: string;
  onSubmit: (input: { decision: string | null; reason: string }) => void;
}) {
  const reasonRef = useRef<HTMLInputElement>(null);
  const reasonError = errors?.reason;
  useEffect(() => {
    if (errors?.reason !== undefined) reasonRef.current?.focus();
  }, [errors]);

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
      <Form onSubmit={handleSubmit} aria-busy={submitting} className="rounded-md border p-4">
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
            aria-required="true"
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
