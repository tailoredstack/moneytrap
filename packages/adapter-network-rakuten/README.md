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

## What was verified live

One read-only run against `api.linksynergy.com` with the project's Rakuten application (the live smoke test, plus a probe
that printed response shapes only):

- `POST /token` with the base64 credential as Bearer and a body of `scope={account-id}` alone returns 200. No
  `grant_type` is needed.
- `GET /v2/advertisers` returns advertisers with a numeric `id` and `network`, and a `_metadata._links.next` link.
- `GET /v2/advertisers/{id}` returns the advertiser with `network`, `can_partner`, and `policies.international_capabilities.ships_to`.
- `GET /v1/partnerships/{id}` returns 404 with a `{msg, code}` body when there is no partnership. `GET /v1/partnerships`
  returns an empty `partnerships` list for this account.
- `GET /events/1.0/transactions` accepts the `YYYY-MM-DD HH:mm:ss` query dates, `limit`, and `page`, and returns `[]`.

The account has no partnerships and no transactions yet, so the live run could not exercise approved programs, offers,
deep links, or real transaction rows. Those are covered by the fake upstream built from the published specification.
`POST /v1/links/deep_links` was not called live, because it writes a link into the dashboard.

## Mappings that are decisions, not documented facts

- A program is the publisher's partnership with an advertiser. Its source ID is the advertiser ID.
- Partnership status maps `active` to approved, `pending` to pending, and the self/decline/remove states to rejected.
  `extended` is not described in the guide, so it maps to no approval.
- The revision is a digest of the mapped fields, because Rakuten sends none.
- Countries come from the advertiser's Rakuten `network` (1 US, 3 GB, 5 CA, 7 FR, 8 BR, 9 DE, 41 AU). The APIs expose no
  channel list or eligibility text, so `channels` is empty and eligibility is `null`. The eligibility policy therefore
  denies every channel until a source for channels exists.
- A transaction's amount is `commissions`. The Events API sends no status: a row is `approved` when `lock_status` is
  `Locked`, `reversed` when its amount is negative, and `pending` otherwise.
- Events paging ends at the first empty page, not at a short page, because the API may cap `limit`. A row more than a
  second outside the window it was queried for fails the page, which would show the query dates are read in another zone.
- HTTP 403 is read as the rate limit, as the specification describes it.

## Not verified

- No public sandbox host is documented, so the adapter targets `api.linksynergy.com` (production) and takes a base URL
  override. The live run was read-only.
- What `is_event` means for cancellations, the meaning of a negative amount, and the Events time zone for query dates
  (read as UTC). Rows in BRL, which the platform does not carry, fail the page rather than being dropped.
- The response format of `GET /v1/partnerships/{id}`: the specification names the object `partnership`, the guide's
  example `partnerships`. Both are accepted.
- The `GET /v1/offers` response for real offers, and the `POST /v1/links/deep_links` response, which no live call reached.
