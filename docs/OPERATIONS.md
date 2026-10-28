# Deployment and delivery behavior

Start with the [Node hosting guide](../examples/node-host/README.md) for deployment steps. This page describes the transport, delivery and provider boundaries that deployment operators need to preserve.

## Outbound webhook transport

`vite.node.config.ts` chooses Nitro's node-server target outside Lovable. The installed Lovable build environment pins its own target; self-host builds must run outside that environment. `start:node` installs a Node-only checked-address-pinned HTTPS transport before loading `.output/server/index.mjs`. Do not start that output directly if you want pinned delivery. The startup loader uses `tsx` for the same shared IP/URL safety rules as the app.

For each delivery the adapter resolves all OS DNS answers, rejects any private/reserved answer, freezes one checked address through HTTPS `lookup`, disables connection pooling/proxy redirects, and retains the original Host, TLS SNI and certificate hostname verification. The destination is re-resolved/rechecked for each new request, never a second time between validation and socket connection. Literal IPs are checked too. HTTPS redirects are returned as failure and never followed; response bytes/time are bounded. `NODE_TLS_REJECT_UNAUTHORIZED=0` is refused at startup. A real public HTTPS echo probe returned 200 and the private-address probe was rejected; transport/TLS/pinning regressions run in npm test.

This removes the split-resolver/rebinding race for application webhook delivery without asserting a network-wide firewall. Database/provider URLs are operator-controlled; general network policy remains defense-in-depth. Hosted delivery still requires verifiable public-only egress policy/bindings for the actual fetch socket path, including IPv6 and internal/metadata targets. Until that evidence exists, leave `BP_PUBLIC_ONLY_EGRESS` unset. The flag is an operator attestation, not a policy installer.

## Delivery and call limits

Inbox inserts use `bp_insert_message`, locking the session row before sequence allocation; direct service-role inserts are denied. Event delivery uses atomic pending/succeeded/retryable states with a 30-second lease. Concurrent duplicates receive `delivery_pending`; successful responses (including voice signaling) are replayed, and failed delivery retries with the same ID redeliver. Expired pending leases can be reclaimed by the next client retry; there is no autonomous recovery queue. Receivers must deduplicate event IDs: crashes/timeouts after external processing cannot guarantee exactly-once external effects.

The client tracks session TTL and call_deadline, stops voice/microphone and cancels stale operations on replay, expiration, revocation, disconnect and mode/connection changes. Public-agent calls have a 15-minute local cap. **Provider-side duration and budget caps are required against hostile browsers**, which can ignore timers, keep old credentials or bypass this UI. Revoking Browser Phone cannot forcibly revoke an already-issued provider session; configure provider controls for that boundary.

Voice signed URLs accept only documented `wss://api.elevenlabs.io/v1/convai/conversation` with agent_id and conversation_signature (or legacy token). Official references: https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets and https://elevenlabs.io/docs/api-reference/conversations/get-signed-url. Regional REST credential endpoints do not prove regional WebSocket support; other hosts fail closed. Opaque third-party WebRTC tokens are disabled because their embedded destination cannot be proven safe; public-agent WebRTC via the SDK remains supported. No real provider audio or hosted n8n execution is guaranteed by unit tests.


## Verification status

The source has been built and exercised locally, including the Node transport, controlled OIDC validation and PostgreSQL-compatible migration tests. See [RELEASE-REVIEW.md](../RELEASE-REVIEW.md) for the recorded checks and their limits.

A publicly deployed current-version service, real MojoAuth email login and an end-to-end provider audio call have not been verified. Shared links require the sharing migration and a working Live backend; optional saved setups also require their migration and provider configuration. Do not present a local test or a successful build as proof of a working hosted voice service.
