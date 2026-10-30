# Moneytrap — UI Skeletons

**Purpose:** low-fidelity layout skeletons for the screens referenced in [IMPLEMENTATION_PLAN.md](../implementation/IMPLEMENTATION_PLAN.md). These show structure, regions, and states. They are not visual designs.

**Conventions**
- `[ ]` a control (button, link, input). `[x]` a checked or active item.
- `(  )` a status or badge. `{ }` a region that can be empty.
- Each screen lists its states in §0. Every screen implements loading, empty, populated, error, permission-denied, and stale where the spec requires.
- Permission-denied and not-found look different on purpose: denied shows a message; not-found is shown for resources the user cannot see.

---

## 0. Shared shell

```
+--------------------------------------------------------------+
| [Skip to content]                              [Account v]   |
+--------------------------------------------------------------+
| Moneytrap | Org: [Acme v]                                       |
+----------------+---------------------------------------------+
| Overview       |  <h1> Page title                            |
| Properties     |  ( status )  as of 12:04 · Data current     |
| Links          |                                             |
| Reports        |  { page region }                            |
| Balances       |                                             |
| Payouts        |                                             |
| Developer      |                                             |
| ----           |                                             |
| Ops (staff)    |                                             |
+----------------+---------------------------------------------+
| Footer: status page · privacy · help                         |
+--------------------------------------------------------------+
```

**Shell states:** session expired banner; org switch confirmation; offline banner (`aria-live="polite"`).

---

## 1. Wave 2 — Identity and access

### 1.1 Register (UI-001)
```
+------------------------------------+
| Create your account                |
|                                    |
| Email          [______________]    |
|   (error: enter a valid email)     |
| Password       [______________]    |
|   Requirements: 12+ characters     |
|                                    |
| [ Create account ]                 |
|                                    |
| Already have an account? Log in    |
+------------------------------------+
```
**States:** submitting (button disabled, `aria-busy`), validation error (focus moves to first error), success (generic "check your email" for known and unknown addresses).

### 1.2 Login and step-up (UI-003, UI-004)
```
+------------------------------------+        +------------------------------------+
| Log in                             |        | Confirm it's you                   |
| Email     [____________]           |        | Enter the 6-digit code from your   |
| Password  [____________]           |        | authenticator app.                 |
| [ Log in ]   Forgot password?      |        | Code [_ _ _ _ _ _]                 |
+------------------------------------+        | [ Confirm ]  Use a recovery code   |
                                              +------------------------------------+
```
**States:** rate-limited (retry time shown), wrong code (count shown, no secret echoed).

### 1.3 Security overview (UI-006) and MFA setup (UI-009)
```
+--------------------------------------------------------------+
| Account security                                              |
| ( MFA: enabled )   Sessions: 3 active   [Manage sessions]     |
+--------------------------------------------------------------+
| MFA setup (shown once)                                        |
|  [QR code]   Or enter key: ABCD-EFGH-...  [Copy]              |
|  Enter code [______]  [ Confirm ]                             |
|  Recovery codes (shown once)                                  |
|   1. xxxx-xxxx   2. xxxx-xxxx  ...   [Copy all] [Download]    |
|  [x] I saved my recovery codes                                |
+--------------------------------------------------------------+
```

### 1.4 Recovery request and reset (UI-007, UI-008)
```
Request:  Email [______] [ Send reset link ]
          "If an account exists, we sent a link." (same for all)

Reset:    New password [______]  Confirm [______]  [ Set password ]
          (error state: "This link has expired. Request a new one.")
```

### 1.5 Organization and members (UI-011, UI-013, UI-014)
```
+--------------------------------------------------------------+
| Members                                       [ Invite ]      |
+----------+--------------------+-----------+-----------------+
| Name     | Email              | Role      | Status          |
+----------+--------------------+-----------+-----------------+
| Ana      | ana@example.com    | Owner     | ( active )      |
| Sam      | sam@example.com    | Member    | ( invited )     |
+----------+--------------------+-----------+-----------------+
| { empty: "Invite a teammate to share access." }               |
+--------------------------------------------------------------+
```
**Invitation accept:** `Join Acme as Member [ Accept ] [ Decline ]`; already-member state: "You're already a member."

---

## 2. Wave 3 — Publisher and property

### 2.1 Publisher onboarding status (UI-005, UI-016)
```
+--------------------------------------------------------------+
| Your publisher account                                        |
| Step 1 Account       [x] done                                 |
| Step 2 Business (KYB)  [ ] start  -> ( not started )          |
| Step 3 Properties      [ ] locked until approval              |
| Step 4 Review          ( in review, typical 2 business days ) |
+--------------------------------------------------------------+
```

### 2.2 KYB form (UI-015)
```
Legal name      [____________]
Country         [ select v ]
Business type   ( ) Individual  ( ) Company
Document        [ Upload ]  Stored securely; we keep a reference only.
[ Submit for review ]   (disabled until required fields valid)
```

### 2.3 Property inventory and registration (UI-019, UI-020, UI-021)
```
+--------------------------------------------------------------+
| Properties                                    [ Add website ]  |
+----------------------+------------------+-----------------------+
| Domain               | Status           | Action                |
| blog.example.com     | ( approved )     | [View]                |
| news.example.com     | ( verify DNS )   | [Instructions]        |
| shop.example.com     | ( suspended )    | [Details]             |
+----------------------+------------------+-----------------------+
| { empty: "Add your first website to start linking." }          |
+--------------------------------------------------------------+
```
**Verification instructions:**
```
Add this TXT record to news.example.com:
  moneytrap-verify=ab12cd34...          [Copy]
Expires in 23 h.     [ Check now ]
Last check: no record found (retry in 60 s).
```

### 2.4 Property details (UI-025)
```
news.example.com          ( verified )  ( review pending )
Monetizable: No: approval pending.
Links: 0 active
[ Submit for review ] (enabled only when verified)
```

---

## 3. Wave 3 — Ops console

### 3.1 Review queue (UI-017, UI-023)
```
+--------------------------------------------------------------+
| Review queue       Filter [Pending v]  Search [________]      |
+----------------------+-----------+-----------+---------------+
| Item                 | Type      | Waiting   | Action        |
| news.example.com     | Property  | 2 d       | [Review]      |
| Acme Media           | KYB       | 5 h       | [Review]      |
+----------------------+-----------+-----------+---------------+
| Showing 1–25 of 143 · [Prev] [Next]                          |
+--------------------------------------------------------------+
```

### 3.2 Decision (UI-018, UI-024)
```
+--------------------------------------------+-----------------+
| Evidence                                   | Decision        |
|  - DNS challenge: verified 10:02           | ( ) Approve     |
|  - Domain WHOIS: [view]                    | ( ) Reject      |
|  - Documents: (restricted: not shown)      | ( ) Suspend     |
|                                            | Reason* [____]  |
|                                            | [ Submit ]      |
+--------------------------------------------+-----------------+
```
**States:** reason required (inline error, focus moves to field), submitted (button disabled), permission denied for reviewers lacking document access.

### 3.3 Audit viewer (UI-077)
```
Object: property news.example.com        [Filter: decisions v]
+----------+-------------+------------------+---------+--------+
| When     | Actor       | Action           | Reason  | Object |
+----------+-------------+------------------+---------+--------+
| 10:20    | r.lee       | approve          | DNS ok  | prop_1 |
+----------+-------------+------------------+---------+--------+
```

---

## 4. Wave 4 — Network and directory

### 4.1 Merchant directory (UI-028)
```
+--------------------------------------------------------------+
| Programs              Search [______]  Country [All v]        |
| Filters: [Channel: Website x]  [Eligible only ☐]              |
+--------------------------------------------------------------+
| Merchant      | Commission | Status              |            |
| Acme Store    | 8%         | ( eligible )        | [Open]     |
| Foo Shoes     | 5%         | ( not eligible: geo)| [Why?]     |
| Bar Travel    | —          | ( unknown )         | [Why?]     |
+--------------------------------------------------------------+
| { no results: "No programs match. Try removing a filter." }  |
+--------------------------------------------------------------+
```

### 4.2 Program terms and reasons (UI-029, UI-030)
```
Acme Store                        ( eligible )
Countries: US, CA     Channels: Website
Terms: 30-day cookie...
Why this decision:
  - Your property is approved (10:20)
  - Program allows your country
[ Request approval ]  (if status requires)
```

### 4.3 Network status (UI-026, UI-076)
```
Network: Example Network          ( temporarily unavailable )
Last successful sync: 3 h ago    Catalog data: data_stale
Capabilities:  Transactions ✓   Adjustments ✗ (unsupported)
[ Retry sync ] (ops only)
```
**Credential panel (ops):** `Credential ✓ configured · last rotated 2026-08-02`. The value is never shown.

---

## 5. Wave 5 — Links and analytics

### 5.1 Create link (UI-032)
```
+--------------------------------------------------------------+
| New link                                                     |
| Program   [ Acme Store v ]   ( eligible )                    |
| Destination [https://acme.example/sale_________]             |
|   (error: this host isn't allowed for this program)          |
| Label     [______________]                                   |
| Preview: https://go.moneytrap.example/r/tk_abc...   [Copy]     |
| [ Create link ]   [ Cancel ]                                 |
+--------------------------------------------------------------+
```

### 5.2 Links list and detail (UI-031, UI-033)
```
+--------------------------------------------------------------+
| Links                  [ New link ] [ Bulk CSV ]              |
| Filter [Active v]  Search [________]                         |
+----------------+--------------+---------------+--------------+
| Label          | Program      | Status        | Clicks 7d    |
| Summer sale    | Acme Store   | ( active )    | 1,204        |
| Old banner     | Foo Shoes    | ( revoked )   | 33           |
+----------------+--------------+---------------+--------------+
Detail: [Pause] [Revoke] (confirm dialog, reversible: no)
```

### 5.3 Bulk CSV (UI-034, UI-035)
```
Upload [ choose file ]   Template [Download]
Result: 995 created · 5 failed
+-----+----------------------+---------------------------------+
| Row | Problem              | Fix                             |
+-----+----------------------+---------------------------------+
| 12  | Destination missing  | Add destination URL             |
| 88  | Host not allowed     | Use an approved host            |
+-----+----------------------+---------------------------------+
[ Retry failed rows ]   [ Download error report ]
```

### 5.4 Click analytics (UI-037)
```
Clicks · Last 7 days · as of 12:04 · ( data current )
[Chart: daily clicks]              (chart has a table alternative)
+------------+--------+-----------+
| Day        | Clicks | Conversions|
| Mon        | 1,204  | —         |
+------------+--------+-----------+
Showing 1–50 · [Next]
```
**Stale state:** `( data stale: last update 26 h ago )` replaces the values' freshness label; numbers stay visible with the badge.

---

## 6. Wave 6 — Balances, statements, finance ops

### 6.1 Publisher balance (UI-046)
```
Balances · USD · as of 12:04
+--------------------------+----------------+
| Estimated (not approved) | $412.00        |
| Approved (pending clear) | $188.20        |
| Available                | $75.00         |
| Reserved for payout      | $0.00          |
+--------------------------+----------------+
[ Why is my balance not available? ]
```
**Stale state:** `Approved: — (data stale, last update 2 d ago)`. Never `$0.00`.

### 6.2 Statements (UI-043, UI-053)
```
Statements
+----------+---------------+-----------+-------------------+
| Period   | Total         | Status    | Action            |
| Sep 2026 | $1,204.10     | Closed    | [View] [Download] |
+----------+---------------+-----------+-------------------+

Statement Sep 2026 · closed · hash 9f2c…
  Line items (paginated) ...
```

### 6.3 Exceptions queue (UI-040)
```
Exceptions   Reason [All v]    Status [Open v]
+-----------+----------------+------------+-----------------+
| Conversion| Reason         | Amount     | Action          |
| c_981     | No matching click | $12.00  | [Investigate]   |
| c_982     | Outside window    | $4.00   | [Investigate]   |
+-----------+----------------+------------+-----------------+
```

### 6.4 Import list (UI-039)
```
Imports
+----------+----------+--------+---------------------------+
| Batch    | Date     | Status | Detail                    |
| b_12     | 10:00    | ( ok ) | 1,204 rows · 0 errors     |
| b_13     | 11:00    | ( failed ) | timeout · [Retry]     |
+----------+----------+--------+---------------------------+
```

---

## 7. Wave 7 — Payouts

### 7.1 Payout history (UI-052)
```
Payouts
+------------+------------+---------------------------------------+
| Date       | Amount     | Status                                |
| 2026-10-01 | $75.00     | ( paid )                              |
| 2026-10-15 | $80.00     | ( processing )  Usually 1–3 business days |
| 2026-10-29 | $40.00     | ( status being confirmed )  We'll update this automatically. |
+------------+------------+---------------------------------------+
```

### 7.2 Batch approval (UI-050, UI-051)
```
Batch PB-2041 · prepared by j.doe
Lines: 1,204 · Total: $48,210.00 USD · as of 12:04
Checks: [x] Reservations match available   [x] No holds unresolved
Approver must be different from preparer.
[ Approve batch ]   [ Cancel batch ]
```
**States:** approved (button disabled), same-user block (message names the rule), cap exceeded (shows cap value).

### 7.3 Method enrollment (UI-047, UI-048)
```
Payout method
  Current: Bank ending 1234 ( active )
  [ Add or change method ]  -> provider-hosted page
Return from provider: ( error: enrollment not completed ) [ Try again ]
```

---

## 8. Wave 8 — Developer

### 8.1 API keys (UI-054, UI-055)
```
API keys                                         [ Create key ]
+----------------+-----------+--------------+--------+---------+
| Name           | Scopes    | Last used    | Status | Action  |
| Reporting prod | reports:r | 2 h ago      | active | [Rotate]|
+----------------+-----------+--------------+--------+---------+

Create key: Name [______]  Scopes [x] reports:read  [ ] links:write
[ Create ]
---- shown once ----
Key: pk_live_************ [Copy]   [x] I've stored this key
```

### 8.2 Webhooks (UI-057, UI-058, UI-059)
```
Webhooks                                        [ Add endpoint ]
+------------------------+-----------+----------------+--------+
| URL                    | Status    | Last delivery  | Action |
| https://hooks.acme.io  | ( active )| 200 · 2 min    | [Log]  |
+------------------------+-----------+----------------+--------+
Delivery log: 10:02 attempt 1 → 500 · 10:03 attempt 2 → 200
[ Send test ]
```

### 8.3 Export center (UI-060)
```
Exports
+------------+-------------+--------------------+--------------+
| Requested  | Type        | Status             | Action       |
| 10:00      | Clicks CSV  | ( processing )    | —            |
| Yesterday  | Earnings    | ( completed )     | [Download]   |
| Last week  | Clicks CSV  | ( failed )        | [Retry]      |
+------------+-------------+--------------------+--------------+
Download links expire after 24 h.
```

---

## 9. Wave 9 — Optimize (after legal gate)

### 9.1 Install wizard (UI-068)
```
Step 1  Copy script   [ Copy ]     ( disabled: waiting for consent setup )
Step 2  Connect CMP   Status: ( not connected )
Step 3  Choose sites  [x] blog.example.com
Step 4  Enable        [ Enable Optimize ]  (requires steps 1–3)
```

### 9.2 Rules editor (UI-069)
```
Rules                                          Version 4 (active)
Exclude categories  [Finance x] [Health x]
Max rewrites per page [ 5 ]
Preview: 12 links would change on sample page   [ Publish ]
```

### 9.3 Install health (UI-070) and decision explanation (UI-074)
```
Health: ( blocked: CMP not reachable )  Last check 2 min ago
Decision for link Acme Store on /post-42:
  Rewritten · Reason: rule "Finance excluded" not matched · Policy v4
  [ View all decisions ]
```

---

## 10. Public and cross-cutting

### 10.1 Redirect error page (UI-036)
```
+--------------------------------------------+
| We couldn't send you to that page.         |
| The link may have been turned off.         |
| [ Go to homepage ]                         |
+--------------------------------------------+
```
(Used for 410 and 503. Different copy for 503: "Try again in a moment.")

### 10.2 Empty, error, and stale patterns
```
Empty:        { icon } No <things> yet.  [ Primary action ]
Error:        We couldn't load <things>.  [ Try again ]   Ref: req_123
Stale:        ( data stale · last update <time> )   numbers remain visible
Forbidden:    You don't have access to this. Ask an organization owner.
Not found:    (for foreign resources, same as missing) Page not found.
```

---

## 11. Coverage map

| Skeleton | Screens (UI IDs) | Wave |
|---|---|---|
| 1.1 | UI-001 | W2 |
| 1.2 | UI-003, UI-004 | W2 |
| 1.3 | UI-006, UI-009 | W2 |
| 1.4 | UI-007, UI-008 | W2 |
| 1.5 | UI-011, UI-013, UI-014 | W2 |
| 2.1 | UI-005, UI-016 | W3 |
| 2.2 | UI-015 | W3 |
| 2.3, 2.4 | UI-019 to UI-022, UI-025 | W3 |
| 3.1 to 3.3 | UI-017, UI-018, UI-023, UI-024, UI-077 | W3 |
| 4.1 to 4.3 | UI-026 to UI-030, UI-073, UI-076 | W4 |
| 5.1 to 5.4 | UI-031 to UI-037 | W5 |
| 6.1 to 6.4 | UI-039 to UI-043, UI-046, UI-053 | W6 |
| 7.1 to 7.3 | UI-047 to UI-052 | W7 |
| 8.1 to 8.3 | UI-054 to UI-060 | W8 |
| 9.1 to 9.3 | UI-067 to UI-074 | W9 |
| 10.1, 10.2 | UI-036, shared patterns | W1 onward |

Not yet covered by a skeleton: UI-010 (devices), UI-012 (org legal settings), UI-044/045 (settlement reconciliation), UI-049 (finance overview), UI-061 to UI-066 (risk and privacy), UI-071, UI-075. Add them before their waves start.
