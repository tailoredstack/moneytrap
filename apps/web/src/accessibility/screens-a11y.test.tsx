import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InvitationView } from "../features/access/invitation-view";
import { MembersView } from "../features/access/members-view";
import { AuditTable } from "../features/audit/audit-table";
import { AccountSecurityView } from "../features/identity/account-security-view";
import { LoginView } from "../features/identity/login-screen";
import { RecoveryRequestView, ResetPasswordView } from "../features/identity/recovery-screens";
import { RegisterView } from "../features/identity/register-screen";
import { SessionsView } from "../features/identity/sessions-view";
import { StepUpView } from "../features/identity/step-up-screen";
import { DecisionView, QueueView } from "../features/ops-review/ops-review-views";
import { NO_QUEUE_FILTER, pageQueue, type QueueItem } from "../features/ops-review/review-logic";
import { PropertyDetailsView } from "../features/properties/property-details-view";
import { PropertyInventoryView } from "../features/properties/property-inventory-view";
import { VerificationInstructions } from "../features/properties/verification-instructions";
import { KybFormView } from "../features/publisher/kyb-form-view";
import { OnboardingStatusView } from "../features/publisher/onboarding-status-view";

// WP-X.5 accessibility checks for the wave 2 and wave 3 screens (docs/ui/SKELETONS.md, moneytrap-frontend rules).
// Each screen renders in a live DOM so that focus, accessible names, and error association can be read back.
// The audit write-up is docs/ui/A11Y-AUDIT-W2-W3.md.

const CONTROL = "input:not([type=hidden]), select, textarea";

// The accessible name as a screen reader computes it for the controls used here. Labels win over text content.
function nameOf(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();
  if (el.tagName === "BUTTON") return el.textContent?.trim() ?? "";
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent?.trim() ?? "";
  }
  const wrapping = el.closest("label");
  if (wrapping) return wrapping.textContent?.trim() ?? "";
  return "";
}

function unnamedControls(root: Element): string[] {
  return [...root.querySelectorAll(`${CONTROL}, button`)]
    .filter((el) => nameOf(el) === "")
    .map((el) => el.outerHTML.slice(0, 80));
}

function duplicateButtonNames(root: Element): string[] {
  const names = [...root.querySelectorAll("button")].map((el) => nameOf(el));
  return names.filter((name, index) => names.indexOf(name) !== index);
}

// An invalid control must say why, through an element that exists and has text.
function invalidWithoutMessage(root: Element): string[] {
  return [...root.querySelectorAll('[aria-invalid="true"]')]
    .filter((el) => {
      const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      return !ids.some((id) => (document.getElementById(id)?.textContent ?? "").trim() !== "");
    })
    .map((el) => el.outerHTML.slice(0, 80));
}

const mounted: { root: Root; container: HTMLElement }[] = [];

function render(node: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

const item: QueueItem = {
  id: "item-01",
  type: "property",
  label: "news.example.com",
  waitingSince: "2026-10-30T00:00:00Z",
};

const emptyKyb = { legalName: "", country: "", businessType: null } as const;

const screens: [string, () => ReactElement][] = [
  ["register (UI-001)", () => <RegisterView status="idle" />],
  [
    "register with an invalid email",
    () => <RegisterView status="invalid" invalidField="email" message="Enter a valid email." />,
  ],
  ["login (UI-003)", () => <LoginView status="idle" />],
  ["login after a failed attempt", () => <LoginView status="failed" />],
  [
    "step-up with a wrong code (UI-004)",
    () => <StepUpView status="invalid" mode="totp" wrongCount={2} message="That code is not right." />,
  ],
  ["step-up with a recovery code", () => <StepUpView status="idle" mode="recovery" />],
  ["recovery request (UI-007)", () => <RecoveryRequestView status="idle" />],
  ["password reset with a mismatch (UI-008)", () => <ResetPasswordView status="mismatch" />],
  ["account security, MFA not enabled (UI-006)", () => <AccountSecurityView mfaEnabled={false} sessionCount={2} />],
  [
    "account security, MFA setup (UI-009)",
    () => (
      <AccountSecurityView
        mfaEnabled={false}
        sessionCount={2}
        setup={{ totpURI: "otpauth://totp/Moneytrap?secret=ABCD", backupCodes: ["aaaa-bbbb", "cccc-dddd"] }}
        error="That code is not right."
      />
    ),
  ],
  [
    "sessions",
    () => (
      <SessionsView
        sessions={[
          { token: "t1", createdAt: "2026-10-30T10:00:00Z", userAgent: "Firefox on Linux", current: true },
          { token: "t2", createdAt: "2026-10-29T10:00:00Z", userAgent: "Safari on macOS", current: false },
        ]}
      />
    ),
  ],
  [
    "members with the invite form open (UI-011)",
    () => (
      <MembersView
        state="ready"
        canInvite
        inviteOpen
        members={[{ id: "m1", name: "Ana", email: "ana@example.com", role: "owner", status: "active" }]}
      />
    ),
  ],
  ["members, permission denied", () => <MembersView state="denied" members={[]} canInvite={false} />],
  ["invitation (UI-014)", () => <InvitationView state="ready" orgName="Acme" memberRole="member" />],
  ["KYB form with errors (UI-015)", () => <KybFormView values={emptyKyb} submitAttempted />],
  ["publisher onboarding status (UI-005)", () => <OnboardingStatusView status="in_review" asOf="2026-10-30" />],
  [
    "property inventory (UI-019)",
    () => (
      <PropertyInventoryView
        asOf="2026-10-30"
        rows={[
          { id: "p1", domain: "blog.example.com", status: "approved" },
          { id: "p2", domain: "news.example.com", status: "verification_pending" },
        ]}
      />
    ),
  ],
  [
    "property details (UI-025)",
    () => <PropertyDetailsView domain="news.example.com" status="verified" asOf="2026-10-30" changedElsewhere />,
  ],
  [
    "verification instructions (UI-020)",
    () => (
      <VerificationInstructions
        domain="news.example.com"
        challenge="moneytrap-verify=ab12"
        expiresInHours={23}
        lastCheck="no record found"
        copyState="idle"
      />
    ),
  ],
  [
    "review queue (UI-017)",
    () => (
      <QueueView
        page={pageQueue([item, { ...item, id: "item-02", type: "kyb", label: "Acme Media" }], 1)}
        filter={NO_QUEUE_FILTER}
        onFilterChange={() => {}}
        onPageChange={() => {}}
        onReview={() => {}}
      />
    ),
  ],
  [
    "decision (UI-018)",
    () => (
      <DecisionView
        item={item}
        evidence={[{ id: "e1", label: "DNS challenge: verified", kind: "check" }]}
        canViewDocuments={false}
        submitting={false}
        onSubmit={() => {}}
      />
    ),
  ],
  [
    "audit viewer (UI-077)",
    () => (
      <AuditTable
        entries={[
          {
            id: "a1",
            actor: { type: "user", id: "r.lee" },
            scope: "publisher",
            action: "approve",
            reason: "DNS ok",
            occurredAt: "2026-10-30T10:20:00Z",
            object: { type: "property", id: "prop_1" },
          },
        ]}
      />
    ),
  ],
];

describe("WP-X.5 screens: labelled controls, named buttons, and described errors", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => root.unmount());
      container.remove();
    }
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  for (const [name, build] of screens) {
    test(`${name}: every control and button has an accessible name`, () => {
      expect(unnamedControls(render(build()))).toEqual([]);
    });

    test(`${name}: no two buttons share a name, so each action says what it acts on`, () => {
      expect(duplicateButtonNames(render(build()))).toEqual([]);
    });

    test(`${name}: every invalid control is described by its message`, () => {
      expect(invalidWithoutMessage(render(build()))).toEqual([]);
    });
  }
});

describe("WP-X.5 focus on error and on open", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => root.unmount());
      container.remove();
    }
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("a wrong step-up code moves focus to the code field and marks it invalid", () => {
    render(<StepUpView status="invalid" mode="totp" message="That code is not right." />);
    expect(document.activeElement?.id).toBe("step-up-code");
    expect(document.getElementById("step-up-code")?.getAttribute("aria-invalid")).toBe("true");
  });

  test("a failed login moves focus to the password field and marks it invalid", () => {
    render(<LoginView status="failed" />);
    expect(document.activeElement?.id).toBe("login-password");
    expect(document.getElementById("login-password")?.getAttribute("aria-invalid")).toBe("true");
  });

  test("a mismatched new password moves focus to the confirmation field", () => {
    render(<ResetPasswordView status="mismatch" />);
    expect(document.activeElement?.id).toBe("reset-confirmation");
    expect(document.getElementById("reset-confirmation")?.getAttribute("aria-invalid")).toBe("true");
  });

  test("a rate-limited sign-in does not move focus away from the submit button", () => {
    render(<StepUpView status="rate-limited" mode="totp" retryAfterSeconds={30} />);
    expect(document.activeElement?.id).not.toBe("step-up-code");
  });

  test("KYB: while invalid, the submit button says what is still needed", () => {
    const container = render(<KybFormView values={emptyKyb} />);
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    const described = document.getElementById(submit.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe("Still needed: legal name, country, business type.");
  });

  test("KYB: the submit button stays reachable by keyboard and points at the first problem", () => {
    const container = render(<KybFormView values={emptyKyb} />);
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    act(() => submit.click());
    expect(document.activeElement?.id).toBe("kyb-legal-name");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter the legal name.");
  });

  test("MFA setup: a wrong confirmation code moves focus to the code field", () => {
    render(
      <AccountSecurityView
        mfaEnabled={false}
        sessionCount={1}
        setup={{ totpURI: "otpauth://totp/Moneytrap?secret=ABCD", backupCodes: ["aaaa-bbbb"] }}
        error="That code is not right."
      />,
    );
    expect(document.activeElement?.id).toBe("mfa-code");
  });

  test("members: opening the invite form moves focus to its email field", () => {
    render(<MembersView state="ready" canInvite inviteOpen members={[]} />);
    expect(document.activeElement?.id).toBe("invite-email");
  });

  test("property details: a disabled submit says why it is disabled", () => {
    const container = render(
      <PropertyDetailsView domain="news.example.com" status="verified" asOf="2026-10-30" changedElsewhere />,
    );
    const submit = [...container.querySelectorAll("button")].find((b) => b.textContent === "Submit for review");
    if (!submit) throw new Error("submit not rendered");
    expect(submit.disabled).toBe(true);
    const described = document.getElementById(submit.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toMatch(/Refresh/);
  });

  test("review queue: the count is a status region so filter and page changes are announced", () => {
    const container = render(
      <QueueView
        page={pageQueue([item], 1)}
        filter={NO_QUEUE_FILTER}
        onFilterChange={() => {}}
        onPageChange={() => {}}
        onReview={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Showing 1–1 of 1");
  });

  test("decision: the required reason is marked as required for assistive technology", () => {
    const container = render(
      <DecisionView item={item} evidence={[]} canViewDocuments={false} submitting={false} onSubmit={() => {}} />,
    );
    expect(container.querySelector("#decision-reason")?.getAttribute("aria-required")).toBe("true");
  });
});

describe("WP-X.5 KYB follows the record it is given", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => root.unmount());
      container.remove();
    }
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("a new record replaces the fields, so validation reads the loaded values", () => {
    const container = render(<KybFormView values={emptyKyb} />);
    const { root } = mounted[mounted.length - 1] ?? {};
    if (!root) throw new Error("root not mounted");
    act(() =>
      root.render(<KybFormView values={{ legalName: "Acme Media", country: "GB", businessType: "company" }} />),
    );
    expect((container.querySelector("#kyb-legal-name") as HTMLInputElement).value).toBe("Acme Media");
    expect(container.querySelector("button[type='submit']")?.getAttribute("aria-disabled")).toBeNull();
  });
});
