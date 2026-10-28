# Browser Phone Node self-host

This is a concrete Node deployment target, not the Lovable Worker target. Core use and shared testing need no signup; saved-setup login is optional. No infrastructure purchase is needed to read/run the source; hosting, database and provider charges remain yours.

## Prerequisites

- Node 22.12+ and npm; use `npm ci` with included lockfile.
- Your own empty PostgreSQL/Supabase-compatible deployment with service-role API access. Apply all seven migration files `drizzle/migrations/0000` through `0006` **in journal order** using your database administrator/migration tooling. Use a clean isolated database for migration-from-zero verification. This Lovable project does not expose its managed service key to users; do not ask for it or extract it.
- Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, publishable/browser variables as needed, and `BP_PUBLIC_BASE_URL=https://phone.your-domain.example` using a secret manager. Build-time browser settings must target your own database. Never commit `.env` values. `BP_PUBLIC_ONLY_EGRESS` stays unset: pinned delivery does not need that attestation.
- Public HTTPS reverse proxy to localhost:3000. Call/mic UI requires HTTPS in browsers (localhost exception). Reverse proxy should also cap inbound bodies at 16 KB. Do not disable TLS certificate checks.

Migration `0005` adds the optional saved-setup tables, and `0006` adds shared test links. Apply all migrations in journal order for this source version; session handlers expect the sharing schema. Login remains unavailable until its provider settings are configured. See [optional login](../../docs/MOJOAUTH.md) and [sharing](../../docs/SHARING.md).

## Build and run

Outside the Lovable managed build environment (which pins its preset):

```sh
npm ci
npm test                       # DB tests skip without credentials
npm run build:node             # explicit vite.node.config.ts, Nitro node-server
HOST=127.0.0.1 PORT=3000 npm run start:node
```

Expected output entry: `.output/server/index.mjs`; assets in `.output/public`. `scripts/start-node.mjs` installs checked-address pinning **before** importing the entry. Starting the output entry directly leaves webhook delivery disabled unless a separate enforced-egress attestation is present. Production process must retain the repository's startup script, shared safety source, tsx dependency and compiled `.output`.

The production Node artifact was built and launched locally on Node 26.0.0. Its home page returned HTTP 200, and the capability endpoint reported `enabled:true, transport:"node-pinned"` with the egress-attestation flag unset. The Node transport was also exercised over public HTTPS; private-address rejection and pinned Host/SNI/certificate options have regression coverage. A complete paired deployment against your database and a real provider call still require deployment-specific testing.

## Live smoke test

1. GET `/api/public/v1/connections` should return `enabled:true, transport:"node-pinned"`. Unset hosted capability returns disabled.
2. Run the sample webhook behind another public HTTPS URL. Set its `BP_PHONE_ORIGIN` to this phone's exact HTTPS origin.
3. Register the webhook in the Live panel, read its display-only pairing code, verify it, then restart the sample with the signing secret from registration.
4. Send a message; confirm the callback reply appears. For calls, configure `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` on the sample webhook only. Configure provider-side time/budget caps and use an actual microphone browser on HTTPS.
5. Run `npm test` with test database credentials: all fixture messages use `bp_insert_message`. Inbox backlog regression uses 55 maximal multibyte messages plus links; call-generation test ensures an old call timer cannot end its successor.

## Pinned connection properties

OS lookup resolves every address; any unsafe answer fails closed. The adapter pins the chosen public IP in the `https.request` lookup callback while preserving original Host and TLS SNI; certificate verification checks the original hostname. No proxy settings or pooled sockets are used. No redirects are followed. Request timeout covers response bytes; 64 KB response maximum. Rebinding after lookup cannot change the socket address. Unverified/disabled TLS startup fails closed.

This is application-level checked/pinned delivery, not a claim of network-wide public-only egress. For hosted Live to work instead, the unresolved prerequisite is deployment-specific official policy/binding evidence or controlled network tests proving private/reserved IPv4/IPv6/internal/metadata destinations are denied at actual connection time. It remains unavailable here.
