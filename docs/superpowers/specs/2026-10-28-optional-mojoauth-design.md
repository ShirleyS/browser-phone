# Optional saved setups with MojoAuth

The user explicitly requested optional login now after approving a signup-free browser phone. Add an optional Save my setup section to Connect. Anonymous messaging, scenarios, provider voice and the existing per-webhook quota retain their access model. Logging in is never required to open or test the phone.

## Approved product scope

- Passwordless email login through MojoAuth's hosted login page, configured for email magic links/OTP by the deployment operator.
- Save contact name, fake display number, language, public agent ID and an existing paired connection.
- List, restore and remove a user's saved setups on another device. Sign out clears account access and the current device's connection credentials without revoking other devices.
- Login does not prove webhook ownership. Saving a connection requires a valid, unexpired connection capability and server-confirmed pairing. Existing token expiry/revocation still applies; expired/revoked saved connections restore settings and require pairing again.
- No chat history, recordings, transcripts, signing secrets or permanent provider credentials are saved.

## Implementation choices

These are builder choices, not additional user requirements. Use the existing TypeScript/TanStack app, public API route prefix, Postgres backend and MIT license. Use standard OIDC with openid-client, not a client-side MojoAuth script: no request to MojoAuth until the user explicitly signs in. This also keeps self-hosters independent of a proprietary frontend SDK.

OIDC authorization code flow uses PKCE S256, state and nonce. The server discovers the configured HTTPS issuer, validates ID token signature/issuer/audience/expiry/nonce, and exchanges codes server-side. Client secret and identity tokens never reach application JavaScript. Use a ten-minute encrypted, HttpOnly, SameSite=Lax transient cookie and a server-stored one-time state hash; consume it atomically on callback before exchange. A fixed configured app origin supplies the callback and success/failure destinations; no arbitrary return URLs.

After login, issue a random opaque HttpOnly SameSite=Lax cookie. Store only its hash, stable owner hash derived from issuer and subject, and seven-day expiry in a service-only session table. Identity is never based on an email supplied by the browser. Logout deletes the current session; expired sessions fail closed. Secure cookies are required outside localhost. No account token in localStorage/sessionStorage, URL query, exports or Inspector.

Saved setups use a service-only table and AES-256-GCM encrypted payloads with a required deployment secret. Bind encryption to owner and record ID via authenticated additional data. Only the authenticated owner's records can be listed/restored/deleted. List responses contain labels/IDs/dates only; connection capabilities are returned only by an explicit same-origin POST restore, never GET lists. Every mutation requires exact Origin match. Account routes have no permissive CORS and all responses are no-store. Save only this deployment's paired connections, ignoring any client-supplied API base. Cap each account at twenty saved setups atomically.

The Save section is initially collapsed. Opening it checks optional feature/session capability. Without provider configuration, show a truthful unavailable message while all anonymous functions continue to work. Login redirects back to a fixed app root flag that opens the section; no authorization codes or tokens remain on the final page. Restore changes settings/connection but never starts a call. Remove affects only the saved copy; existing Forget connection remains the global webhook revocation action.

## Configuration and release limits

Required server settings: MojoAuth issuer, client ID, client secret, a fixed public app origin, and a random 32-byte account encryption key. Apply the additional migration to the isolated Browser Phone database. Never provision against Ring Orden or copy its keys. No live provider credentials are currently available in this checkout; implement, verify with a controlled OIDC provider fixture, document activation, and report real MojoAuth email login as unverified until configured. The public Lovable demo still depends on restoring browser access; do not claim it is published.

## Verification

Builder-check clarifications: auth start uses an exact-origin POST form; the OIDC callback is exempt from Origin checks and instead validates its transient cookie/state binding before atomically consuming state. AES-GCM uses a fresh unpredictable 96-bit IV on every encryption. Host-only cookies use Path=/ and HttpOnly, with Secure and __Host- names in production; localhost alone permits insecure development cookies.

Test anonymous/offline behavior with auth absent; state/nonce/code replay, wrong signatures/issuer/audience/expiry, cross-origin mutation rejection, owner isolation, ciphertext tampering, unpaired/expired/revoked connection handling, concurrent save limit, signout revocation, restoration without automatic calling, and secret exclusion from lists/exports/client bundles. Run the regression suite, TypeScript and production Node build/startup. Verify migration SQL in a local Postgres-compatible test engine or an isolated test database; distinguish that from a managed production migration.
