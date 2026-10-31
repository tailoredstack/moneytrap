# Accessibility audit: waves 2 and 3 (WP-X.5)

**Scope:** every screen built so far in waves 2 and 3, against [SKELETONS.md](SKELETONS.md) and the accessibility rules in the moneytrap-frontend skill: labels on every control, errors announced through live regions, focus moved to the first error on submit, no colour-only status.

**Method:**
- Automated DOM checks in `apps/web/src/accessibility/screens-a11y.test.tsx`, run in a live DOM (happy-dom) so focus can be read back. They check, for each screen state:
  - every control and button has an accessible name (label, `aria-label`, `aria-labelledby`, or wrapping label);
  - no two buttons on one screen share a name, so repeated actions say what they act on;
  - every `aria-invalid` control is described by a message that exists and has text;
  - focus moves to the field that needs correcting after a failed submit, and stays put for rate limits;
  - disabled actions say why, and status regions exist where the screen changes without navigating.
- Static review of the keyboard path: DOM order, skip link, focusable `main`, focus rings, no positive `tabIndex`, and no click handlers on non-interactive elements.

**Not covered by this audit:** a real screen reader pass (VoiceOver, NVDA) and keyboard-only browser runs. See [Deferred](#deferred).

## Results

Result key: **Pass** = met without change. **Fixed** = gap found and fixed in this change. **Deferred** = not met or not verifiable here, with reason.

### Wave 2: identity and access (WP-2.15)

| Screen (ID) | Checked | Result | Notes |
|---|---|---|---|
| Shell: skip link, main (SKELETONS §0) | Skip link is the first focusable element; `main` takes focus; focus rings present | Pass | Offline and session-expired banners: **Deferred**. Neither is built yet, so there is nothing to audit. |
| Register (UI-001) | Labels, `aria-invalid`, description, focus to first error, `aria-busy`, sent status | Pass | Already the reference pattern. Covered by existing tests and the new checks. |
| Login (UI-003) | Labels, failed-sign-in announcement, focus | **Fixed** | A failed sign-in did not move focus or mark the password field. Now focuses the password field, sets `aria-invalid`, and links the message. |
| Step-up (UI-004) | Labels, wrong-code error, focus, description | **Fixed** | A wrong code did not move focus or link the message to the field. Now focuses the code field and links the error. |
| Recovery request (UI-007) | Labels, same reply for known and unknown addresses, rate-limit message | Pass | The sent state is a status region. |
| Reset password (UI-008) | Labels, mismatch error, expired link, focus | **Fixed** | A mismatch did not move focus to the confirmation field. Now focuses it and marks it invalid. Expired-link message is an alert (pass). |
| Account security and MFA setup (UI-006, UI-009) | Labels, error focus, disabled Confirm, button names | **Fixed** | Wrong password or code errors now focus and describe their field. Disabled Confirm now says what to tick. |
| Sessions (manage sessions) | Button names per session | **Fixed** | Every Revoke button had the same name. Each now names its device and time. |
| Members (UI-011) | Labels, table caption, invite form focus, invite error | **Fixed** | Opening the invite form did not move focus; the table had no caption; the invite error was not linked to its field. Denied state is a status region (pass). |
| Invitation (UI-014) | Accept and Decline names, state messages | Pass | Buttons sit under the heading that names the organization. States are status regions. |

### Wave 3: publisher and property (WP-3.10)

| Screen (ID) | Checked | Result | Notes |
|---|---|---|---|
| Publisher onboarding status (UI-005, UI-016) | Step list as text, status text, stale marker | Pass | Status is text, not colour. |
| KYB form (UI-015) | Labels, per-field errors, focus on submit, submit reachability | **Fixed** | Errors were one message for the whole form, not tied to fields, and focus did not move. Submit was `disabled` while invalid, so keyboard users could not reach it. Now each error sits under its field, the first invalid field takes focus on every attempt, and Submit stays focusable (`aria-disabled`) and explains itself. The form now has a submit handler; before, it had none. |
| Property inventory (UI-019) | Table headers, button names, status text | **Fixed** | Every row's View or Instructions button had the same name. Each now names its domain. Table gets a caption. Status icons are decorative; the text carries the meaning (pass). |
| Verification instructions (UI-020, UI-021) | Copy button name, copy result announcement | Pass | Copy result is a status (success) or alert (failure). |
| Property details (UI-025) | Disabled submit explanation, status change in another tab | **Fixed** | A disabled Submit gave no reason. The reason is now written out and linked to the button. The other-tab change is a status region (pass). |

### Wave 3: ops console (WP-3.8)

| Screen (ID) | Checked | Result | Notes |
|---|---|---|---|
| Review queue (UI-017, UI-023) | Filter and search labels, button names, result count, Prev and Next | **Fixed** | Every Review button had the same name. Each now names its item. Prev and Next now say "Previous page" and "Next page". The count is a status region, so filter and page changes are announced. |
| Decision form (UI-018, UI-024) | Radio group, reason field, required mark, error focus, busy state | **Fixed** | Reason is marked `aria-required`, and the form is `aria-busy` while submitting. Focus on an empty reason (TP-W3-024) already passed and still passes. |

### Wave 3: audit viewer (WP-3.9)

| Screen (ID) | Checked | Result | Notes |
|---|---|---|---|
| Audit viewer (UI-077) | Column headers, table caption, empty state | **Fixed** | The table had no caption. Now it has one. The decisions filter in SKELETONS §3.3 is not built yet, so it is **Deferred** until it exists and should get the same checks. |

## Deferred

- **Screen reader pass.** Announcements were checked as DOM roles and text, not with VoiceOver or NVDA. Reason: no screen reader rig in this repo. Follow-up: a manual pass on the wave 2 and wave 3 flows before the next wave with UI.
- **Keyboard-only browser runs.** The test plans call for keyboard-only E2E paths (for example TP-W2-046 for register and verify). The repo has no browser E2E runner, so the keyboard checks here are DOM-level: focus targets, order, and reachability. Follow-up: add a browser E2E runner, then add keyboard-only specs for each wave's pilot flow.
- **Focus after client-side navigation.** Route changes are not checked. Whether focus moves to the new page heading is not verified. Follow-up: check it with the browser E2E runner above.
- **Offline and session-expired shell banners** (SKELETONS §0). Not built yet.
- **Audit viewer filter** (SKELETONS §3.3). Not built yet.
