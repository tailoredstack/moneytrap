# Moneytrap — Test Plans by Wave

One test plan per wave in [implementation/WAVES.md](../implementation/WAVES.md). Each plan lists the work packages it covers, test IDs, layers, entry and exit criteria, data, and risks.

| Wave | Plan | Conformance cases | Milestone |
|---|---|---|---|
| W0 | [wave-00-foundations.md](wave-00-foundations.md) | CT stubs only | M0 |
| W1 | [wave-01-kernel.md](wave-01-kernel.md) | — | M0→M1 |
| W2 | [wave-02-identity-access.md](wave-02-identity-access.md) | CT-001 to CT-005, CT-008 | M1 |
| W3 | [wave-03-publisher-property.md](wave-03-publisher-property.md) | CT-006, CT-007 | M2 |
| W4 | [wave-04-network-eligibility.md](wave-04-network-eligibility.md) | CT-009, CT-010 (part), CT-015 | M3 |
| W5 | [wave-05-links-redirect.md](wave-05-links-redirect.md) | CT-006 (link), CT-010, CT-011, CT-013, CT-014 | M4 |
| W6 | [wave-06-ledger-conversions.md](wave-06-ledger-conversions.md) | CT-012, CT-016 to CT-018, CT-020 | M5 |
| W7 | [wave-07-settlement-payouts.md](wave-07-settlement-payouts.md) | CT-019, CT-021, CT-022 | M6 |
| W8 | [wave-08-developer-platform.md](wave-08-developer-platform.md) | Developer suite | M7 |
| W9 | [wave-09-optimize.md](wave-09-optimize.md) | Optimize suite | M8 |

## Shared rules

- **Layers:** unit (domain), property (domain and ledger), action/query (real Postgres, faked external ports), HTTP (`app.handle`), conformance (`packages/conformance`), E2E (built binary).
- **Authorization tests** sit at the HTTP guard layer, not inside actions. An action test that needs a permission check is in the wrong place.
- **IDs** follow `TP-W<wave>-<nnn>`. IDs are never reused; retired tests are marked `retired` with the reason.
- **Failing seed** from any property test becomes a permanent regression case in the same wave.
