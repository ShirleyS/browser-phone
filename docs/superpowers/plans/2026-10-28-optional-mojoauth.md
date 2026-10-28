# Optional MojoAuth saved setups implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** optional passwordless login and private saved/restorable setups, preserving anonymous phone use.

**Architecture:** a server-side OIDC adapter, encrypted vault and opaque cookie sessions. Account endpoints use explicit same-origin checks and owner-scoped service-role queries; no change to existing public capability APIs or quotas. A collapsed Connect section offers login and save/restore/remove/signout.

**Tech stack:** existing TypeScript/React/TanStack, openid-client v6, WebCrypto, Postgres/Supabase.

**Spec:** ../specs/2026-10-28-optional-mojoauth-design.md

## Global constraints

- Anonymous use and 20 sessions per webhook per UTC day remain unchanged.
- No permanent provider keys, identity tokens, signing secrets or chat history in the vault/frontend.
- Require current paired connection capability to save a connection; restored expired/revoked connections require pairing again.
- Optional feature stays unavailable without all provider, origin and encryption settings. No fake authentication success.
- Host credentials stay outside source; no Ring Orden resources or production keys are used.

## Review focus

- OIDC state/nonce/code replay and forged ID tokens cannot issue an app session.
- Cross-origin requests and other account owners cannot read or mutate vault entries.
- Invalid, expired or revoked connection capabilities never regain access through saved settings.
- Anonymous loading causes no MojoAuth request, and restore never starts a call.
- Logout clears this device's account/connection capability without revoking another device.

### Task 1: authentication and encrypted persistence boundary

Files: src/server/account/{config,crypto,oidc,store,handlers}.ts; src/lib/account/types.ts; route handlers under src/routes/api/public/v1/account*; Drizzle custom migration plus journal; tests under src/test/account*.test.ts.

Interfaces: `accountStatus(request)`, `beginLogin(request)`, `finishLogin(request)`, `listSetups(request)`, `saveSetup(request)`, `restoreSetup(request,id)`, `removeSetup(request,id)`, `signOut(request)` return Response. Inject OIDC and repository dependencies into handler factory for real protocol/in-memory behavior tests. Production exports wire the configured provider and typed store.

- [x] Write failing tests for disabled capability, authenticated session isolation, CSRF, verified pairing, encrypted payload AAD/tampering, expiry/revocation, login state replay and provider validation.
- [x] Run tests to observe failures for missing behavior, then implement minimal modules.
- [x] Use openid-client's authorization code flow with PKCE/state/nonce and ID-token signature checks, fixed origin/callback, encrypted transient cookie and atomic one-time state consumption. Opaque account session cookies expire after seven days.
- [x] Generate custom migration via existing Drizzle tooling. New session/state/vault tables enable RLS and deny anon/authenticated access; all queries are owner-scoped. Save RPC caps rows at twenty atomically.
- [x] Exercise migration and permission checks in local PG-compatible engine or isolated DB. Record managed-deployment migration as unverified if unavailable.
- [x] Run account tests and baseline suite; include backend in the reviewed feature commit.

### Task 2: optional saved setup UI

Files: src/components/workbench/SavedSetups.tsx, Workbench.tsx, src/lib/account/{client,types}.ts, component tests.

Consumes account routes; produces exported SavedSetups component taking engine/state. API payload settings: label, contact, lang, agentId, optional connection ID and connection token; no API base supplied by client.

- [x] Write failing component tests for anonymous collapsed state, login link, save, restore without auto-call, remove and signout cleanup/error handling.
- [x] Implement initially collapsed bilingual section; query account status only when opened or a fixed callback flag is present.
- [x] Hide/disable login truthfully when configuration is unavailable; show errors without tokens/provider details. No account/provider token in persistent browser storage or Inspector.
- [x] Restore via explicit same-origin POST and engine setting methods; clear local capability on signout without global revoke.
- [x] Run UI and regression tests; include UI in the reviewed feature commit.

### Task 3: documentation, independent review and release

Files: .env.example, README.md, SECURITY.md, OpenAPI, source allowlist as needed, activation guide.

- [x] Document MojoAuth hosted email flow setup, exact callback URI, server-only credentials/key, migration and independent self-hosting. Keep auth disabled by default.
- [x] Test config absence, source secret exclusion and Node production build/startup. Run full tests and TypeScript once integrated.
- [x] Request fresh whole-change review, fix Important/Critical issues with regressions, record remaining provider/deployment limits.
- [x] Publish reviewable source changes without rewriting history or overwriting concurrent work. Activate real login only when project credentials and callback settings are configured; never claim a real email login was tested when only a controlled provider fixture was used.
