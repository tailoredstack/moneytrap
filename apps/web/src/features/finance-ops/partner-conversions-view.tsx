import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@moneytrap/ui";
import { formatTimestamp, type LoadState, LoadStateFrame } from "../directory/load-state";
import { formatMoney, type Money } from "./money";
import { UnavailableNotice } from "./unavailable";

export interface PartnerConversion {
  id: string;
  status: "tracked" | "pending" | "approved" | "reversed";
  reportedAt: string;
  source: string;
  amount: Money | null;
}

export type PartnerConversionsState = LoadState<PartnerConversion[]> | { kind: "unavailable" };

const STATUS_LABEL: Record<PartnerConversion["status"], string> = {
  tracked: "Tracked",
  pending: "Pending",
  approved: "Approved",
  reversed: "Reversed",
};

// UI-041. Every row names its status in words, with the time the partner reported it and where it came from.
export function PartnerConversionsView({ state }: { state: PartnerConversionsState }) {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Partner-reported conversions</h1>
      {state.kind === "unavailable" ? (
        <UnavailableNotice label="Partner-reported conversions" />
      ) : (
        <LoadStateFrame state={state} label="partner conversions">
          {(conversions) =>
            conversions.length === 0 ? (
              <p className="text-sm">No partner-reported conversions yet.</p>
            ) : (
              <Table>
                <caption className="sr-only">Partner-reported conversions</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Conversion</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Reported</TableHead>
                    <TableHead scope="col">Source</TableHead>
                    <TableHead scope="col" className="text-right">
                      Amount
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversions.map((conversion) => (
                    <TableRow key={conversion.id}>
                      <TableCell className="font-mono">{conversion.id}</TableCell>
                      <TableCell>{STATUS_LABEL[conversion.status]}</TableCell>
                      <TableCell>{formatTimestamp(conversion.reportedAt)}</TableCell>
                      <TableCell>{conversion.source}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(conversion.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </LoadStateFrame>
      )}
    </section>
  );
}
