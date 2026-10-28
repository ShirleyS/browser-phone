# Browser Phone

An open-source testing phone you connect to your own app. It looks like a WhatsApp-style
smartphone and sits next to a developer workbench (Connect, Scenarios, Inspector, Docs).
No sign-up required. Optional MojoAuth login lets you save setups. MIT licensed.

- **Offline demo**: works right away with no backend, no credentials, no AI and no cost. Messages get labeled demo replies; calls are simulated (ringing, answer, decline, mute, speaker, hang up, timer).
- **Scenarios**: incoming call/message, delayed reply, disconnect, failed delivery, receipt and payment links (all simulated, pointing to example.com).
- **Live mode**: register a public HTTPS webhook, prove you own it with a one-time pairing code, then events go to your app and your replies show up on the phone.
- **Bring-your-own voice (ElevenLabs)**: your webhook returns a short-lived signed URL (or you enter a public agent ID). Audio goes straight from the browser to ElevenLabs. Browser Phone never sees your API key.
- **Inspector**: shows every request (redacted), the status, how long it took, and any errors. It never reports success when something failed.
- **Export/Import + Replay**: sanitized JSON. Replays run in the offline engine and never make outside calls.
- **Embed**: `?embed=1&parent_origin=…&session=…`, controlled by a postMessage protocol that checks the parent origin and session.

## Quick start (offline demo)

```bash
npm ci
npm run demo        # http://localhost:8080 — offline mode needs no env vars
```

## Download the source

The demo and build commands automatically regenerate the source download before starting. Run `npm run build:source` to generate it separately.

The running app serves a reproducible source archive at **`/downloads/browser-phone-source.zip`**
(link in the Docs tab). Rebuild it with `npm run build:source`. It's built from a strict
allowlist and excludes `.env` files (except `.env.example`), credentials, `.git`, `node_modules`,
caches, logs and the archive itself. The public MIT-licensed repository is [ShirleyS/browser-phone](https://github.com/ShirleyS/browser-phone). Clone it with `git clone https://github.com/ShirleyS/browser-phone.git`, then run `npm ci` and `npm run demo`. The downloadable ZIP is a source snapshot; it does not contain credentials or installed dependencies.

## Self-hosting Live mode

Hosted webhook messages/calls remain disabled: no official Lovable documentation or visible deployment binding proves independently enforced public-only outbound connections here. The Live panel checks capability before registration and labels this explicitly. Sources reviewed: https://docs.lovable.dev/tips-tricks/deployment-hosting-ownership and https://developers.cloudflare.com/workers-vpc/api/ (private networking is configuration-dependent, not a blanket public-only guarantee).

### Pinned Node self-host path

Node **22.12+** (Vite requires a supported modern Node release), npm, a separately provisioned compatible database, and a public HTTPS reverse proxy are required. No infrastructure is purchased by this project. Full instructions: [`examples/node-host/README.md`](./examples/node-host/README.md).

```sh
npm ci
npm run build:node
# Set database credentials and BP_PUBLIC_BASE_URL in your deployment secret manager.
# Do NOT set BP_PUBLIC_ONLY_EGRESS merely to bypass the guard.
HOST=127.0.0.1 PORT=3000 npm run start:node
```

`vite.node.config.ts` chooses Nitro's node-server target outside Lovable. The installed Lovable build environment pins its own target; self-host builds must run outside that environment. `start:node` installs a Node-only checked-address-pinned HTTPS transport before loading `.output/server/index.mjs`. Do not start that output directly if you want pinned delivery. The startup loader uses `tsx` for the same shared IP/URL safety rules as the app.

For each delivery the adapter resolves all OS DNS answers, rejects any private/reserved answer, freezes one checked address through HTTPS `lookup`, disables connection pooling/proxy redirects, and retains the original Host, TLS SNI and certificate hostname verification. The destination is re-resolved/rechecked for each new request, never a second time between validation and socket connection. Literal IPs are checked too. HTTPS redirects are returned as failure and never followed; response bytes/time are bounded. `NODE_TLS_REJECT_UNAUTHORIZED=0` is refused at startup. A real public HTTPS echo probe returned 200 and the private-address probe was rejected; transport/TLS/pinning regressions run in npm test.

This removes the split-resolver/rebinding race for application webhook delivery without asserting a network-wide firewall. Database/provider URLs are operator-controlled; general network policy remains defense-in-depth. Hosted delivery still requires verifiable public-only egress policy/bindings for the actual fetch socket path, including IPv6 and internal/metadata targets. Until that evidence exists, leave `BP_PUBLIC_ONLY_EGRESS` unset. The flag is an operator attestation, not a policy installer.

The service you host costs whatever your host and database charge you. Nothing here is free forever.
Voice minutes are billed by your voice provider to your own account.

## API

Base URL: `https://<your-host>/api/public/v1` (the `/api/public` prefix is how public endpoints are routed;
there are no bare `/v1` routes). Full spec: [`public/openapi.json`](./public/openapi.json) (also served at `/openapi.json`).

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

Tokens are only sent in `Authorization: Bearer …` headers, never in query strings. Connection and session-phone tokens are stored only as SHA-256 hashes. Callback tokens also have hashes for verification, but the recoverable callback token is stored to include it in webhook payloads. Signing secrets and webhook URLs may contain credentials; successful event responses can contain voice credentials. These values are service-role-only under RLS with no anonymous/authenticated grants. Restrict database/admin access and backups as secret stores; use deployment encryption-at-rest and retention policies. A token for one session can't read or write any other session.

### Quota

20 new sessions per normalized webhook (scheme + host + port + path, ignoring query) per UTC day by default,
shared by every browser and every re-registration. Messages inside a session don't count. The final slot is reserved atomically
in a database transaction; retries that reuse the `Idempotency-Key` don't use up more of the quota. When the quota is used up the API returns
`429 quota_exceeded` with `reset_at` and `Retry-After`.

## Examples

- [`examples/node-webhook`](./examples/node-webhook) — dependency-free Node webhook with signature check, auto-pairing log, echo replies and an optional ElevenLabs signed-URL mint.
- [`examples/n8n`](./examples/n8n) — n8n workflow + setup steps.
- `npm run check:webhook -- https://your-webhook "$BP_SIGNING_SECRET" "$BP_PHONE_ORIGIN"` — compatibility check for the webhook contract.

## Adding voice providers

Implement `VoiceAdapter` in `src/lib/voice/adapter.ts` and register it in `voiceAdapters`.

## Optional login

Core features need no login. **Save my setup** adds optional MojoAuth hosted login to save and restore phone settings and an already-paired connection across devices. It never saves conversations, recordings, ElevenLabs API keys or webhook signing secrets. Saved connection capabilities are encrypted and retain their original expiry and daily quota.

Login is off until the operator configures a MojoAuth OIDC application, server secrets and the account migration. Follow [docs/MOJOAUTH.md](./docs/MOJOAUTH.md). Account routes use an HttpOnly cookie and same-origin POST protection; webhook/session APIs continue to use scoped bearer tokens and pairing. Actual email delivery must be verified after deployment configuration.

See also [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).

## Delivery and call limits

Inbox inserts use `bp_insert_message`, locking the session row before sequence allocation; direct service-role inserts are denied. Event delivery uses atomic pending/succeeded/retryable states with a 30-second lease. Concurrent duplicates receive `delivery_pending`; successful responses (including voice signaling) are replayed, and failed delivery retries with the same ID redeliver. Expired pending leases can be reclaimed by the next client retry; there is no autonomous recovery queue. Receivers must deduplicate event IDs: crashes/timeouts after external processing cannot guarantee exactly-once external effects.

The client tracks session TTL and call_deadline, stops voice/microphone and cancels stale operations on replay, expiration, revocation, disconnect and mode/connection changes. Public-agent calls have a 15-minute local cap. **Provider-side duration and budget caps are required against hostile browsers**, which can ignore timers, keep old credentials or bypass this UI. Revoking Browser Phone cannot forcibly revoke an already-issued provider session; configure provider controls for that boundary.

Voice signed URLs accept only documented `wss://api.elevenlabs.io/v1/convai/conversation` with agent_id and token. Official references: https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets and https://elevenlabs.io/docs/api-reference/conversations/get-signed-url. Regional REST credential endpoints do not prove regional WebSocket support; other hosts fail closed. Opaque third-party WebRTC tokens are disabled because their embedded destination cannot be proven safe; public-agent WebRTC via the SDK remains supported. No real provider audio or hosted n8n execution is guaranteed by unit tests.

## Tests

`npm test` runs offline tests without DB configuration (DB suites skip cleanly). To exercise live DB regressions, provide server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for an isolated test database with these migrations, then run `npm test`. Fixture fingerprints are unique and cleaned up. Never put credentials on the command line or in exports.

Inbox pages are capped at **60,000 UTF-8 bytes including the JSON envelope**, below the client 65,536-byte read limit; cursors advance only over included rows. A 55-message backlog with 4,000-character CJK text and long links is verified through real database inserts, server pages and engine polls without gaps. Ordinary hangup clears only that call's deadline timers; old session deadlines cannot end a newer call or unrelated chat.
