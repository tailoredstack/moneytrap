import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DecisionView } from "./ops-review-views";
import type { DecisionErrors, QueueItem } from "./review-logic";

// Interactive, because focus only moves in a live DOM. Static markup cannot show it (TP-W3-024).
const item: QueueItem = {
  id: "item-01",
  type: "property",
  label: "news.example.com",
  waitingSince: "2026-10-30T00:00:00Z",
};

// Like the parent screen: each rejected submit stores a new errors object, which is what moves focus.
function Harness() {
  const [errors, setErrors] = useState<DecisionErrors | undefined>();
  return (
    <DecisionView
      item={item}
      evidence={[]}
      canViewDocuments={false}
      submitting={false}
      errors={errors}
      onSubmit={(input) => {
        if (input.reason.trim() === "") setErrors({ reason: "Enter a reason for this decision." });
      }}
    />
  );
}

describe("DecisionView focus on invalid submit (TP-W3-024)", () => {
  let root: Root;
  let container: HTMLElement;

  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  function submitForm() {
    const form = container.querySelector("form");
    if (!form) throw new Error("form not rendered");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  test("focus moves to the reason field on every blank submit, not only the first", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));

    submitForm();
    expect(document.activeElement?.id).toBe("decision-reason");

    // The reviewer tabs away to Submit and submits again with the reason still blank.
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    act(() => submit.focus());
    expect(document.activeElement?.id).not.toBe("decision-reason");

    submitForm();
    expect(document.activeElement?.id).toBe("decision-reason");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter a reason for this decision.");

    act(() => root.unmount());
    container.remove();
  });
});
