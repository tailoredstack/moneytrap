import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyInventoryView, type PropertyRow } from "./property-inventory-view";

const ASOF = "2026-10-31T12:04:00.000Z";

const rows: PropertyRow[] = [
  { id: "prop_1", domain: "blog.example.com", status: "approved" },
  { id: "prop_2", domain: "news.example.com", status: "verification_pending" },
  { id: "prop_3", domain: "shop.example.com", status: "suspended" },
];

// TP-W3-028 and SKELETONS §2.3: status is shown as text with an icon, never colour alone.
describe("PropertyInventoryView (TP-W3-028, UI-019, UI-020, UI-021)", () => {
  test("a suspended property shows the word Suspended with an icon", () => {
    const html = renderToStaticMarkup(<PropertyInventoryView rows={rows} asOf={ASOF} />);
    expect(html).toContain("shop.example.com");
    expect(html).toContain("Suspended");
    expect(html).toContain('data-status-icon="suspended"');
    expect(html).toContain('aria-hidden="true"');
  });

  test("every row carries a text status, so no state is colour only", () => {
    const html = renderToStaticMarkup(<PropertyInventoryView rows={rows} asOf={ASOF} />);
    expect(html).toContain("Approved");
    expect(html).toContain("Verify DNS");
  });

  test("each row's action is a button a publisher can use", () => {
    const html = renderToStaticMarkup(<PropertyInventoryView rows={rows} asOf={ASOF} />);
    expect(html).toMatch(/<button[^>]*>Instructions<\/button>/);
    expect(html).toMatch(/<button[^>]*>View<\/button>/);
  });

  test("an empty inventory invites the first website", () => {
    const html = renderToStaticMarkup(<PropertyInventoryView rows={[]} asOf={ASOF} />);
    expect(html).toContain("Add your first website to start linking.");
  });
});
