# Optional MojoAuth saved setups

The basic phone works without an account or MojoAuth. Opening Save my setup checks the local account API; the browser does not load a MojoAuth script. Only clicking Sign in redirects to the configured hosted login page.

## Activate on your own deployment

1. Apply `drizzle/migrations/0005_optional_mojoauth_accounts.sql` after migrations 0000–0004 to the isolated Browser Phone database. It adds service-only account sessions, login attempts and encrypted saved setups. Do not apply it to another app's database.
2. Create/select a MojoAuth OIDC application. Enable email magic links or email OTP on its hosted login page. Use its OIDC issuer, client ID and client secret; a legacy publishable SDK key is not a substitute.
3. Register this exact redirect URI: `https://phone.example.com/api/public/v1/account/callback`, replacing the origin with your deployment's origin. For local testing register `http://127.0.0.1:5191/api/public/v1/account/callback` if your MojoAuth project permits localhost callbacks.
4. In the hosting secret manager set `MOJOAUTH_ISSUER`, `MOJOAUTH_CLIENT_ID`, `MOJOAUTH_CLIENT_SECRET`, `BP_PUBLIC_BASE_URL` (the exact app origin), and `BP_ACCOUNT_ENCRYPTION_KEY`. Generate the last value with `openssl rand -hex 32`. All are server settings; never prefix secrets with VITE_, paste them into the public phone, or commit them. The existing server-only database settings are also required.
5. Restart/redeploy. The hosted OIDC provider must support code flow, PKCE S256, RS256 ID tokens, its JWKS endpoint and `client_secret_basic` authentication. Test a real email login, save, sign out, log in on another device, and load the saved setup. Log in to two accounts and verify their lists stay separate.

Until these settings exist, saving is explicitly unavailable; anonymous scenarios, chat simulation and provider adapter behavior remain available. Missing settings never produce a fake successful login. This integration is tested with a controlled OIDC provider fixture; actual MojoAuth email delivery must be verified after activation.

## What is stored

Saved settings include the contact/display number, language, public agent ID and, optionally, an already paired connection capability for this deployment. Setup labels and dates are visible to their owner; settings and connection capability are AES-256-GCM encrypted with a fresh random IV and authenticated owner/record binding. No conversations, transcripts, recordings, ElevenLabs API keys, webhook signing secrets or temporary voice URLs are saved.

The account identity is derived from the verified issuer and subject, not a browser-supplied email. A random opaque account cookie is HttpOnly, host-only and SameSite=Lax, with Secure/__Host- protection outside localhost; its database record stores only a hash and expires in seven days. Ten-minute login attempts use PKCE, nonce and a one-time state bound to an encrypted transient cookie. Identity tokens stay on the server. Signout revokes this session and clears this tab's connection/messages, without globally revoking other devices.

Email login proves identity, not webhook ownership. Saving a connection requires a valid current connection capability and server-confirmed pairing, checked again in the save transaction. Restoring an expired/revoked connection returns its settings but requires pairing again. Saving never extends its seven-day connection-token lifetime, changes its daily allowance, or bypasses the 20-sessions-per-webhook quota. Direct public-agent voice uses the provider's own limits.

Twenty saved setups per account are allowed. Removing a saved copy does not revoke the webhook connection; use the existing Forget connection action for that. Keep the encryption key stable and backed up securely: losing/rotating it makes existing encrypted saved setups unreadable. Protect database backups and hosting secrets. Periodically delete expired rows from `bp_account_states` and `bp_account_sessions`; expiry is enforced even before cleanup.

MojoAuth is an optional hosted dependency. The application source remains MIT licensed and the anonymous/self-hosted phone needs no MojoAuth account. The standard OIDC adapter can be replaced by self-hosters.

Official references: [MojoAuth hosted OIDC](https://mojoauth.com/docs/hosted-login-page/), [openid-client](https://github.com/panva/openid-client), [ElevenLabs signed connections](https://elevenlabs.io/docs/eleven-agents/customization/authentication).
