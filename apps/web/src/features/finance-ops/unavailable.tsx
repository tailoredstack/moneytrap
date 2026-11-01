// Shown when no route serves the data yet. The screen renders this instead of an empty list, so a missing source is never
// read as "nothing here". The figures arrive with the statements API (OZE-3264).
export function UnavailableNotice({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm">
      {label} are not available yet.
    </p>
  );
}
