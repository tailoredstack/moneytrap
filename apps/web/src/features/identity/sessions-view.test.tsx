import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type SessionRow, SessionsView } from "./sessions-view";

const sessions: SessionRow[] = [
  { token: "tok_current", createdAt: "2026-10-30T09:00:00.000Z", userAgent: "Chrome on macOS", current: true },
  { token: "tok_other", createdAt: "2026-10-29T18:30:00.000Z", userAgent: "Safari on iOS", current: false },
];

describe("SessionsView (UI-006 Manage sessions)", () => {
  test("lists each session with when it started and where it runs", () => {
    const html = renderToStaticMarkup(<SessionsView sessions={sessions} />);
    expect(html).toContain("Chrome on macOS");
    expect(html).toContain("Safari on iOS");
    expect(html).toContain("2026-10-29T18:30:00.000Z");
  });

  test("marks the session in use and offers revoke only for the others", () => {
    const html = renderToStaticMarkup(<SessionsView sessions={sessions} />);
    expect(html).toContain("This session");
    expect(html.match(/>Revoke</g)?.length).toBe(1);
  });

  test("says so when there is nothing to show", () => {
    const html = renderToStaticMarkup(<SessionsView sessions={[]} />);
    expect(html).toContain("No active sessions.");
  });

  test("a failed revoke is announced", () => {
    const html = renderToStaticMarkup(<SessionsView sessions={sessions} error="Could not end that session." />);
    expect(html).toContain("Could not end that session.");
  });
});
