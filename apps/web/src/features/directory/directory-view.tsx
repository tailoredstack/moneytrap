import { Button, FormLabel, Input } from "@moneytrap/ui";
import { actionLabel, type EligibilityDecision, statusText } from "./eligibility-status";
import { Freshness, type LoadState, LoadStateFrame } from "./load-state";

export type DirectoryRow = {
  id: string;
  name: string;
  countries: readonly string[];
  decision: EligibilityDecision;
};

export type DirectoryData = {
  rows: DirectoryRow[];
  asOf: string;
  stale: boolean;
  hasMore: boolean;
};

export type DirectoryFilters = { q: string; country: string; eligibleOnly: boolean };

export const NO_DIRECTORY_FILTERS: DirectoryFilters = { q: "", country: "", eligibleOnly: false };

// SKELETONS §4.1 "Merchant directory" (UI-028). Only eligible programs open directly; every other row explains itself.
export function DirectoryView({
  state,
  countries,
  filters = NO_DIRECTORY_FILTERS,
  onFiltersChange,
  onOpen,
  onLoadMore,
  onRetry,
  onClearFilters,
}: {
  state: LoadState<DirectoryData>;
  countries: readonly string[];
  filters?: DirectoryFilters;
  onFiltersChange?: ((next: DirectoryFilters) => void) | undefined;
  onOpen?: ((id: string) => void) | undefined;
  onLoadMore?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onClearFilters?: (() => void) | undefined;
}) {
  const filtered = filters.q !== "" || filters.country !== "" || filters.eligibleOnly;
  const change = (patch: Partial<DirectoryFilters>) => onFiltersChange?.({ ...filters, ...patch });

  return (
    <section className="max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">Programs</h1>
      <search className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <FormLabel htmlFor="directory-search">Search programs</FormLabel>
          <Input
            id="directory-search"
            type="search"
            value={filters.q}
            onChange={(event) => change({ q: event.target.value })}
            className="w-64"
          />
        </div>
        <div className="space-y-1">
          <FormLabel htmlFor="directory-country">Country</FormLabel>
          <select
            id="directory-country"
            value={filters.country}
            onChange={(event) => change({ country: event.target.value })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All</option>
            {countries.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.eligibleOnly}
            onChange={(event) => change({ eligibleOnly: event.target.checked })}
          />
          Eligible only
        </label>
      </search>
      <LoadStateFrame state={state} label="programs" onRetry={onRetry}>
        {(data) => (
          <div className="space-y-3">
            <Freshness asOf={data.asOf} stale={data.stale} />
            <p role="status" className="text-sm">
              {data.rows.length} {data.rows.length === 1 ? "program" : "programs"} shown
            </p>
            {data.rows.length === 0 ? (
              filtered ? (
                <div className="space-y-2 text-sm">
                  <p>No programs match. Try removing a filter.</p>
                  {onClearFilters ? (
                    <Button variant="outline" size="sm" onClick={() => onClearFilters()}>
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm">No programs yet. Programs appear after your first catalog sync.</p>
              )
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Programs and whether your property may promote them</caption>
                <thead>
                  <tr className="text-left">
                    <th scope="col">Merchant</th>
                    <th scope="col">Countries</th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.countries.join(", ")}</td>
                      <td>{statusText(row.decision)}</td>
                      <td>
                        {onOpen ? (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`${actionLabel(row.decision)} ${row.name}`}
                            onClick={() => onOpen(row.id)}
                          >
                            {actionLabel(row.decision)}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.hasMore && onLoadMore ? (
              <Button variant="outline" onClick={() => onLoadMore()}>
                Load more
              </Button>
            ) : null}
          </div>
        )}
      </LoadStateFrame>
    </section>
  );
}
