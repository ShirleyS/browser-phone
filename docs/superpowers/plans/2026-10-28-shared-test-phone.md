# Shared test phone implementation

Spec: ../specs/2026-10-28-shared-test-phone-design.md

Goal: share an owner's integration with a total allowance of one/few/custom calls, enforced across forwarded links, atop existing quotas.

1. Backend (independent owner): failing PGlite/handler tests; generate custom Drizzle0006; service-only share table and session binding; typed share store/handlers/routes; atomic link creation and call reservations through bp_create_session, exact owner capabilities and revocation; shared session guard and canonical call-start integration in bp/handlers.ts. Verify race/last slot/idempotency/cross-kind/expiry/revocation/role denial/daily quota and no raw secrets in metadata.
2. UI (independent owner): failing component tests; typed shares client; collapsed ShareTestPhone owner panel with1/3/5/custom + expiry, copy/revoke/metadata; test view phone-only with fragment token handling and clear remaining/expiry/error states. No provider key fields.
3. Root integration: engine share routing and ended failure behavior; isolated usePhoneEngine so testers never restore/overwrite owner storage; redaction; connect panel and /test route wiring. Meaningful engine/isolated-storage tests before behavior changes. Offline and owner paths preserved.
4. Integration/release: source/archive/docs/OpenAPI, full tests and TypeScript/build; fresh independent review and fix material findings, local server smoke, publish reviewable source. Real managed migration/provider audio/Lovable deployment remain separate and truthfully unverified without access/config.

Review focus: concurrent last-call attempts, replay after quota exhausted, repeated start IDs, stale UI results, forwarded-link total cap, own-provider credential boundary, private inbox isolation, owner credential/storage exclusion, and expiry/revoke on already-created sessions.
