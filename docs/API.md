# API reference

Connect your own app to Browser Phone using signed webhook events and scoped access tokens. The complete request/response contract is [OpenAPI 3.1](../public/openapi.json), served by a running phone at `/openapi.json`.

## Base URL and core routes

Base URL: `https://<your-host>/api/public/v1` (the `/api/public` prefix is how public endpoints are routed;
there are no bare `/v1` routes). Full spec: [`public/openapi.json`](../public/openapi.json) (also served at `/openapi.json`).

| Method | Path | Auth |
|---|---|---|
| POST | `/connections` | none (rate-limited per webhook) |
| POST | `/connections/{id}/verify` | connection token |
| POST | `/connections/{id}/sessions` | connection token + `Idempotency-Key` |
| GET | `/connections/{id}/usage` | connection token |
| POST | `/connections/{id}/revoke` | connection token |
| POST | `/sessions/{id}/events` | session phone token |
| GET | `/sessions/{id}/messages?after=cursor` | session phone token |
| POST | `/sessions/{id}/messages` | callback token |

### Token scopes

| Token | Prefix | Given to | Can | Expires / revoked |
|---|---|---|---|---|
| Connection token | `bp_conn_` | the browser that registered | verify, create sessions, read usage, revoke | `BP_CONNECTION_TOKEN_TTL_SECONDS` (7 days); `POST /revoke` |
| Session phone token | `bp_phone_` | the phone for one session | post events, read that session's inbox | session TTL; when the connection is revoked |
| Callback token | `bp_cb_` | **only your webhook**, in each event payload | post messages to that session | session TTL; when the connection is revoked |
| Signing secret | `whsec_` | shown once at registration | verify `X-BrowserPhone-Signature` | rotate by registering again |

Core API capability tokens are only sent in `Authorization: Bearer …` headers, never in query strings. Connection and session-phone authentication records store SHA-256 hashes. If an owner opts to save a paired setup, its recoverable connection capability is stored separately in the encrypted account vault; see [optional saved setups](MOJOAUTH.md). Callback tokens also have hashes for verification, but the recoverable callback token is stored to include it in webhook payloads. Signing secrets and webhook URLs may contain credentials; successful event responses can contain voice credentials. These values are service-role-only under RLS with no anonymous/authenticated grants. Restrict database/admin access and backups as secret stores; use deployment encryption-at-rest and retention policies. A token for one session can't read or write any other session.

### Quota

20 new sessions per normalized webhook (scheme + host + port + path, ignoring query) per UTC day by default,
shared by every browser and every re-registration. Messages inside a session don't count. The final slot is reserved atomically
in a database transaction; retries that reuse the `Idempotency-Key` don't use up more of the quota. When the quota is used up the API returns
`429 quota_exceeded` with `reset_at` and `Retry-After`.


## Shared test phones

These routes need no account login. Owners authenticate with the connection token; testers authenticate with the separate, restricted share token.

| Method | Path | Access |
|---|---|---|
| GET / POST | `/connections/{id}/shares` | Owner connection token: list / create test links |
| POST | `/connections/{id}/shares/{shareId}/revoke` | Owner connection token: revoke a link |
| GET | `/shares/{id}` | Share token: contact and remaining allowance; spends no call slots |
| POST | `/shares/{id}/sessions` | Share token + `Idempotency-Key`: create an isolated chat or call session |

Share tokens start with `bp_share_`. The owner receives the raw token once, and the server stores only its hash. The initial test link places it in the URL fragment; subsequent API requests use a bearer header. A tester cannot manage the owner's connection or read another tester's inbox. The call allowance applies to the entire link, including forwarded copies. See [sharing](SHARING.md) for counting, expiry and revocation behavior.

## Optional saved setups

`GET /account` reports availability and sign-in status. Hosted login starts with `POST /account/login` and completes at `GET /account/callback`. The remaining account routes are `/account/logout`, `/account/setups`, `/account/setups/{id}/restore` and `/account/setups/{id}/remove`; methods and schemas are in OpenAPI.

Account routes use an HttpOnly session cookie rather than a capability bearer token. Mutations require same-origin POST requests, and the callback validates its bound OIDC flow. This does not replace webhook pairing or grant access to someone else's connection. See [optional MojoAuth setup](MOJOAUTH.md).

## Receiving events and replying

After pairing, your webhook receives `message.sent`, `call.start` and `call.end` events. Verify the signature over the raw request body before acting. Each event includes a session-specific `reply_url` and `callback_token`; use that token in an Authorization header when sending a later message back to the phone. The webhook can also return an inline reply or a temporary voice connection URL for `call.start`.

Use the [Node webhook example](../examples/node-webhook/README.md) for a working handler, or the [n8n example](../examples/n8n/README.md). [Voice setup](VOICE.md) explains where provider credentials belong. Delivery retries, idempotency and network restrictions are documented in [operations](OPERATIONS.md).
