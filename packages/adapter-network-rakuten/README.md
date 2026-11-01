# @moneytrap/adapter-network-rakuten

The Rakuten Advertising `NetworkConnector` (WP-4.3, ADR-013). It passes the same contract suite as the recorded-fixture
simulator (`runNetworkConnectorContract` in `@moneytrap/test-kit`).

## Configuration

`RAKUTEN_CLIENT_ID`, `RAKUTEN_CLIENT_SECRET`, `RAKUTEN_ACCOUNT_ID`, and optionally `RAKUTEN_API_BASE_URL`. See
`.env.example`. The client ID and secret are secrets: keep them in the environment or the secret store. The access token
is held in memory only.

`bun test` skips `rakuten-connector.live.test.ts` unless all three variables are set.

## What was verified against Rakuten's published documentation

Sources, all on `developers.rakutenadvertising.com`: the Affiliate APIs OpenAPI specification embedded in
`/documentation/en-US/affiliate_apis` (server `https://api.linksynergy.com`), and the guides `access_tokens`,
`try_out_apis`, `events`, `partnerships`, and `postback`.

| Operation | Rakuten API | Capability |
|---|---|---|
| auth | `POST /token`, `Authorization: Bearer base64(client_id:client_secret)`, form body `scope={account-id}`; response `access_token`, `expires_in` (3600) | – |
| `validate_connection` | token exchange, then `GET /v2/advertisers?limit=1` | supported |
| `discover_advertisers` | `GET /v2/advertisers` (`page`, `limit` up to 200, `_metadata._links.next`) | supported |
| `discover_programs` | `GET /v1/partnerships/{advertiser-id}`, `GET /v1/offers?offer_status=active&advertiser=`, `GET /v2/advertisers/{id}` when there is no partnership | supported |
| `resolve_tracking_destination` | `GET /v1/partnerships/{id}` (must be `active`), then `POST /v1/links/deep_links` with `url`, `advertiser_id`, `u1` | supported |
| `list_transactions` | `GET /events/1.0/transactions` by `transaction_date_start/end`, `limit`, `page` | supported |
| `list_adjustments` | none published; the Events guide says commission changes are not reflected after the fact | unsupported |
| `retrieve_settlement_evidence` | Advanced Reports payment reports need a separate web security token, and the specification publishes no response format | unsupported |
| `receive_notifications` | the Postback API sends an unsigned GET, so its origin cannot be verified | unsupported |

Documented limits the adapter respects: the token endpoint and each API allow 100 calls a minute; the Events API holds
about the last 100 days, takes at most a 30-day range, and is documented as directional rather than final.

## Mappings that are decisions, not documented facts

- A program is the publisher's partnership with an advertiser. Its source ID is the advertiser ID.
- Partnership status maps `active` to approved, `pending` to pending, and the self/decline/remove states to rejected.
  `extended` is not described in the guide, so it maps to no approval.
- The revision is a digest of the mapped fields, because Rakuten sends none.
- Countries come from the advertiser's Rakuten network (1 US, 3 GB, 5 CA, 7 FR, 8 BR, 9 DE, 41 AU). The APIs expose no
  channel list or eligibility text, so `channels` is empty and eligibility is `null`. The eligibility policy therefore
  denies every channel until a source for channels exists.
- A transaction's amount is `commissions`. The Events API sends no status: a row is `approved` when `lock_status` is
  `Locked`, `reversed` when its amount is negative, and `pending` otherwise.
- HTTP 403 is read as the rate limit, as the specification describes it.

## Not verified

- No public sandbox host is documented, so the adapter targets `api.linksynergy.com` and takes a base URL override.
- The token request body: the guide's `curl` sends only `scope`, while its text also mentions `grant_type=password`. The
  adapter follows the `curl` example.
- What `is_event` means for cancellations, the meaning of a negative amount, and the Events time zone for query dates
  (read as UTC). Rows in BRL, which the platform does not carry, fail the page rather than being dropped.
- The response format of `GET /v1/partnerships/{id}`: the specification names the object `partnership`, the guide's
  example `partnerships`. Both are accepted.
- The behavior of the partnership and offers endpoints for an advertiser the publisher has no partnership with.
