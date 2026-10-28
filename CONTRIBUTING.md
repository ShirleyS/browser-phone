# Contributing to Browser Phone

Help make it easy to connect an app, open a browser phone and share it for testing. Core phone use and shared testing should remain available without signup.

Useful contributions include clearer first-run setup, working webhook examples, provider adapters, accessible phone controls, translations and fixes backed by a reproducible case. Optional saved setups support the testing flow rather than becoming a requirement for it.

## Run it locally

Requires Node 22.12+ and npm.

```sh
npm ci
npm run demo
```

The offline demo needs no database or provider credentials. For a real integration, use the [getting-started guide](docs/GETTING_STARTED.md) and your own isolated test deployment.

## Check your changes

```sh
npm test
npx tsc --noEmit
npm run build:node
```

Tests include offline/engine, UI, controlled OIDC and local PostgreSQL-compatible migration checks. Live database suites skip without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; point these only at a dedicated test database with the repository's migrations. Never run fixture tests against a production database or commit secrets.

For documentation-only changes, check examples and links, then regenerate the source archive with `npm run build:source`. Do not add tests that merely assert documentation wording.

## Keep these boundaries

- Offline scenarios and replay make no external calls.
- Provider API keys stay on the integration owner's server. Redact capabilities and temporary voice credentials from Inspector/export output.
- Owners authorize sharing with their paired connection capability; testers receive limited access and isolated conversations.
- Session creation goes through the existing atomic quota function. Shared call allowances remain additional to deployment limits.
- Webhook delivery uses the checked outbound transport and signed events; preserve the existing network validation.
- Microphone access begins only after a user's call action, and cleanup releases voice sessions and devices.
- New providers implement `VoiceAdapter` in [src/lib/voice/adapter.ts](src/lib/voice/adapter.ts).

If you change the public API, update [OpenAPI](public/openapi.json), the app's Docs tab and the relevant guides. Document settings in [.env.example](.env.example), keep secrets out of source, and regenerate the downloadable source archive after changes.

Open a pull request explaining the user-visible behavior, relevant checks and any deployment limitations. Do not rewrite published Git history. Report vulnerabilities through the process in [SECURITY.md](SECURITY.md), rather than posting credentials in a public issue.

The project and contributions are released under the [MIT License](LICENSE). MojoAuth is an optional hosted dependency; self-hosters can use the anonymous phone without it.
