# Load profile and SLO (WP-0.10)

**Status:** Draft. Pending product owner sign-off (plan open question Q5). Until signed, the targets below are placeholders taken from the Blueprint.

## Redirect path (spec §8, Blueprint §8)

| Target | Value | Source |
|---|---|---|
| Redirect latency, server side, cache hit | p95 ≤ 50 ms, p99 ≤ 150 ms | Blueprint §8 |
| Revocation effective | ≤ 5 s | Blueprint §8, WP-0.6 |
| Availability | 99.9% monthly, excluding planned maintenance | Blueprint §8 |
| Behaviour with both stores down | 503, never a redirect | WP-0.6 |

## Load profile

- Single hot token.
- 1000 requests, 16 concurrent clients.
- Local Docker Compose stack (`ops/docker-compose.yml`).
- Measured against the built binary.

The spike measured p95 10.83 ms and p99 15.04 ms at this profile, with client round-trip overhead included. See `spikes/redirect/results.json`.

## Sign-off

- [ ] Product owner confirms the latency targets above.
- [ ] Product owner confirms the availability target.

Once signed, update the status line and tick both boxes.
