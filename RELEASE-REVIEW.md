# Release security review — 2026-10-28

## Verification results

- `npm test`: **105 passed**, including **14 live database tests**; no skipped tests with database credentials available.
- Clean environment without database variables: **91 passed, 14 skipped**, no collection crash.
- Preview's automatic build/typecheck: **build OK**, latest verified entry 18:58:15 UTC. No manual build was run because this environment builds automatically.
- Real Node sample launched as a subprocess: malformed JSON, unsigned events, oversized bodies, invalid callback destinations, bootstrap pairing, checker execution and delayed callback failure tested without process crash.
- Browser at localhost: offline send and labeled reply visible; no hydration/runtime errors, no Google Fonts requests; Docs source link and ZIP returned 200; unsupported Live registration returned 503.
- Source archive regenerated with npm lockfile, new migration, examples, tests and this report; sorted allowlist inspection and byte-identical repeat generation verified.

## Fixes and regression coverage

1. **Examples/signatures/callbacks:** Node requires a signature secret for all non-pairing events. Bootstrap pairing has no outbound action. Exact configured HTTPS origin and session messages path are required; credentials, query, fragments and redirects are rejected. Bytes are bounded; malformed JSON and delayed failures are caught. n8n validates raw HMAC before event handling and destinations; uses inline responses only, with no outbound HTTP node. Node README includes run/test/checker instructions. The checker now uses the configured phone origin and a valid-shaped fake session, not compat.invalid. Docs verifier rejects malformed/missing timestamps/signatures. Tests: `node-example.test.ts` (including actual sample/checker and n8n Code-node execution).
2. **Replay:** generation fences, abort controllers, polling cancellation and synchronous resource detachment stop existing live activity before replay. Test starts with active live voice plus chat polling and asserts no further requests.
3. **Audio/session lifecycle:** track TTL/call deadline; terminate audio on deadline, revoke, unavailable inbox (401/410), provider disconnect, connection/mode changes and disconnect scenario. Fence callbacks, late microphone and provider resolutions. Idempotent session responses recover call deadline from stored session. Tests cover all transitions and late resolution cleanup. Provider-side caps remain required against hostile browsers.
4. **Voice destinations:** shared server/client validation before mic access accepts only documented `wss://api.elevenlabs.io/v1/convai/conversation` and bounded agent_id/token parameters; rejects foreign hosts, credentials, fragments, ports, duplicate/unknown query parameters and wrong paths. Official WebSocket and signed-url references are in README. Regional REST hosts are not assumed to be supported WebSocket hosts. Opaque third-party WebRTC tokens fail closed; public-agent SDK flows remain supported. Tests cover hostile URLs and server signaling rejection.
5. **Concurrent first send:** shared pending chat creation produces exactly one session for simultaneous sends; stale creation results after connection changes are discarded. Regression asserts one session request and two events to that session.
6. **Inbox ordering:** `bp_insert_message` locks the session row before sequence allocation and transaction commit. All handler inbox/outbound writers use it. Direct service-role INSERT is revoked, preventing bypass. Live tests cover simultaneous insertion, subsequent cursor reads, dedupe/isolation. All DB-enabled fixtures now use the insertion RPC; migration grants still deny direct service-role insertion. A controlled two-transaction pause-before-commit reproduction was **not** run; current regression exercises live concurrent RPCs, not a deliberately stalled transaction.
7. **Delivery retries:** atomic claim/finish state machine supports pending/succeeded/retryable; 30-second lease recovery and lease-fenced finish. Same event ID after transient 503 redelivers and succeeds; concurrent duplicate waits/receives 409 instead of delivering twice; successful full response including voice is cached. Live handler tests verify all these outcomes. Delivery after crash/timeout is at-least-once: external receiver dedupe is mandatory.
8. **Body limits:** streamed byte-counted request reads (maximum 16 KB), DNS and webhook response reads (64 KB), cancellation before decoding oversized chunks, including absent Content-Length. Regressions cover request limit, configuration upper bound, cancellation and actual oversized webhook response rejection.
9. **URL redaction:** recursively redact HTTP/HTTPS/WS/WSS credentials, query values and fragments, including nested webhook_url strings. Test includes fake credentials in inspector/export input.
10. **Egress:** DNS checks are explicitly not coupled to fetch resolution. Registration/delivery fails closed unless `BP_PUBLIC_ONLY_EGRESS=enforced` attests to independently deployed/tested public-only egress or the Node startup installs checked-address-pinned transport. README/security docs describe proxy/firewall/runtime prerequisites and IPv6/split resolver risks. No blanket Cloudflare private-network blocking claim remains. Tests prove no outbound fetch when unsupported; browser confirms registration 503. This deployment's actual egress enforcement is **not verified**, so Live delivery remains disabled; no attestation secret was set.
11. **Pairing/secrets/offline fonts:** row-locked verification caps concurrent failures at five (live test: 5 invalid, 15 locked, stored count 5). Documentation accurately states recoverable callback tokens, signing secrets, webhook URL credentials and cached voice responses require protected service-only database access and backups. Google Fonts requests removed. Database creation deferred to beforeAll so skipped suites collect safely; npm lockfile is included in allowlist/archive.

## Remaining actual limitations

- No publication performed; no-signup preserved; MojoAuth remains optional/unimplemented; no billing or Ring Orden changes.
- Actual deployment egress boundary is unverified; Live webhooks intentionally disabled until an operator enforces and verifies it. The environment flag is an attestation, not enforcement itself.
- No real ElevenLabs audio call or imported workflow on a hosted n8n instance was exercised. Opaque third-party WebRTC tokens and unverified regional WebSocket origins are intentionally unsupported.
- Live delivery handler regressions use the real database with injected webhook delivery outcomes; they are not a full external webhook/network end-to-end test.
- No autonomous retry worker: pending lease recovery occurs when a client retries after expiry. Receiver-side dedupe is necessary across crashes/timeouts; provider-issued sessions cannot be forcibly revoked by Browser Phone itself.
- Node sample dedupe is bounded/in-memory and asynchronous replies lack durable queue recovery; production needs persistent dedupe/queue. n8n requires version-specific raw binary body support, restricted environment access and proxy body limits.
- Recoverable callback/signing/voice credentials remain stored with service-only access, as accurately documented; application-layer encryption was not added.
- The controlled paused-transaction cursor regression remains unverified; live concurrent RPC tests pass and the lock-before-sequence architecture prevents application writers from allocating out of commit order.

## Focused re-review follow-up

- Inbox pages now measure the complete JSON envelope in UTF-8 and stop before 60,000 bytes. Cursors advance only through included rows. Live regression inserts **55 messages of 4,000 CJK characters with 80-character labels and long links**, then delivers all IDs/text through actual listMessages and PhoneEngine polls without gaps and within the cap.
- quota.db.test.ts already used bp_insert_message in the 99-test source; remaining denial-probe direct insert was removed so every test message fixture uses RPC. Verified installed journal records for **0000 through 0004**, then ran a fresh full npm suite. This was not a migration-from-zero on a newly provisioned database; no empty privileged DB instance is available here.
- Exact call/session-generation timers are cleared on ordinary hangup. Call A with 10-second deadline is hung up, B starts at 2 seconds and stays active past A's old deadline; B ends only at its own deadline and unrelated chat stays usable.
- Added scripts/pinned-outbound.mjs, scripts/start-node.mjs and vite.node.config.ts: resolve/check all addresses, pin one checked address in HTTPS lookup, preserve original TLS SNI/Host/certificate identity, disable pooling/redirects, bound response bytes/time and reject disabled TLS verification. Node regression validates options, mixed unsafe DNS, changed resolver answers and installed delivery. A **real public HTTPS POST to postman-echo.com returned 200 with correct echo**; private literal target was rejected.
- No official Lovable docs/binding evidence establishing hosted public-only networking was found. Public GET /connections reports disabled capability; Live panel explicitly labels webhook-backed messages/calls disabled and prevents registration. Direct public-agent voice remains a separate browser/provider path.
- Node self-host target and startup are documented in examples/node-host/README.md. **Node production output was not built/launched inside the managed sandbox** (automatic builds validate the hosted target); run build:node/start:node in a native Node environment before deployment. No real provider audio, hosted n8n, or full external paired Node deployment was tested.
- Full tests: 105 pass, no skips with DB credentials; clean no-DB run: 91 pass, 14 skip. Hosted automatic build OK, browser disabled registration confirmed with zero runtime errors. Final archive is rebuilt only after these edits; SHA256 is emitted by build:source and served alongside ZIP as browser-phone-source.sha256.

Source-download path: `/downloads/browser-phone-source.zip` (unpublished preview access restrictions still apply).

## Native release verification

- Regenerated the npm lockfile from package.json in an empty directory, including optional platform bindings. A fresh `npm ci --ignore-scripts --no-audit --no-fund` succeeded on macOS arm64; the previous managed-environment lock omitted other platforms.
- Added regressions for HTTP 204/205 webhook responses. They failed before the transport fix and passed after it. The transport uses a null response body for these statuses and catches response construction failures.
- Final local suite: **93 passed, 14 database tests skipped**, 107 total. `npx tsc --noEmit` passed. Database credentials were not copied from the managed deployment.
- `npm run build:node` passed; `HOST=127.0.0.1 PORT=5191 npm run start:node` launched the actual production entry. Home returned HTTP 200; GET `/api/public/v1/connections` returned `enabled:true, transport:"node-pinned"` without an egress attestation.
- Local credential files are excluded by `.gitignore`; only `.env.example` belongs in source. Public hosting's webhook transport remains disabled until independent egress protection is established.
- A full external paired Node deployment, fresh database migration, hosted n8n import, and real provider audio remain outside this verification.

## Public source release verification — 2026-10-28

Release target: https://github.com/ShirleyS/browser-phone . The original license commit is retained as the parent of the source release.

Fresh checks on the release source: `npm test` completed with **93 passed and 14 database tests skipped** because test database credentials were not supplied; `npx tsc --noEmit` passed; `npm run build:node` passed. Earlier managed-environment database test results above are historical evidence, not a claim that this release reran them.

The published source includes the offline phone, voice adapter, server API, migrations, OpenAPI schema, examples, tests, npm lockfile and self-hosting/security/contribution guides. Generated runtime state, installed dependencies and credential files are excluded. The reproducible source download is generated from the reviewed allowlist.

Publishing source does not activate hosted webhooks, provision a database, or prove a real provider audio call. The deployment-specific limitations above remain applicable.


## Optional MojoAuth saved setups — 2026-10-28

Optional hosted OIDC sign-in, service-only encrypted setup vault, owner-scoped restore/remove and bilingual collapsed UI. Anonymous phone use remains available. Login stays unavailable without server configuration.

Verification: 124 tests passed, 14 existing managed-database tests skipped; TypeScript and Node production build passed. Account tests exercise actual openid-client protocol validation with RS256 signed-token fixtures, wrong issuer/audience/nonce/expiry/signature/state, cookie/session isolation, exact-origin mutations, encrypted payload tamper/owner binding, revoked/expired capabilities, UI restore cancellation and signout cleanup after collapse/unmount. PGlite executes the account migration and verifies role denials and the atomic twenty-setup cap. Restricted execution denied the existing webhook test server's loopback bind (EPERM); the authorized final run passed all runnable tests.

Independent whole-change review found one signout lifecycle defect; fixed with two failing-then-passing regressions. Final review found no remaining Critical/Important issues. Real MojoAuth email delivery, project callback registration and managed production migration have not been verified or activated. This source update does not publish a Lovable deployment.
