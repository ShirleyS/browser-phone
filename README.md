# Browser Phone

**Connect your app. Open a browser phone. Share a link for testing.**

Browser Phone is an MIT-licensed testing interface for apps that send messages or use voice agents. Connect your own webhook and voice provider, then let teammates or clients try the experience in a familiar phone UI. Core use and shared testing need no signup.

The display number **+52 55 91100000** is fake. Browser Phone tests browser-based messages and agent calls; it does not dial real phone numbers or connect to WhatsApp.

## Try the offline demo

Requires Node **22.12+** and npm.

```sh
git clone https://github.com/ShirleyS/browser-phone.git
cd browser-phone
npm ci
npm run demo
```

Open the local address printed in the terminal. You can send simulated messages, answer simulated calls and run scenarios without a database or a voice-provider account.

**Status:** the source runs locally. A current public hosted demo has not been verified. The saved-setup and sharing additions are in [PR #1](https://github.com/ShirleyS/browser-phone/pull/1) until merged; use that branch to try those additions. The local demo alone does not activate real webhooks or voice.

## Connect your app

1. Run a Live-capable Browser Phone deployment using the [Node hosting guide](examples/node-host/README.md).
2. Give your app a public HTTPS webhook. The [Node example](examples/node-webhook/README.md) handles pairing, signed events, replies and optional ElevenLabs voice.
3. In **Connect → Live**, register the webhook and enter the pairing code delivered to your app.
4. Send a message or start a call. Your app's replies appear in the phone.

You supply the integration and provider account. For a private ElevenLabs agent, keep the permanent API key on **your backend**; your webhook returns a temporary signed voice URL. Audio connects directly between the tester's browser and ElevenLabs. [Voice setup →](docs/VOICE.md)

## Share a test phone

After pairing your webhook, open **Share a test phone**:

- Choose **1 call, 3 calls, 5 calls, or Custom** (1–100 total call attempts).
- Set an expiry and copy the test link.
- Send it to a tester, who opens a phone-only page without entering credentials or signing up.

Everyone using or forwarding the same link shares its allowance. Each tester gets a separate conversation. Opening the page spends no call slots; starting a call attempt does. The setup owner's integration and provider credits are used. You can revoke a link at any time. Existing daily limits still apply. [Sharing guide →](docs/SHARING.md)

## What else is included

- **Scenarios:** incoming calls/messages, delayed replies, delivery failures, disconnects and example receipt/payment links.
- **Inspector:** request status, timing and errors with credentials redacted.
- **Export, import and replay:** sanitized conversation bundles; replay runs in the offline engine.
- **Embed:** put the phone in your app with an origin-checked `postMessage` bridge.
- **Optional saved setups:** configure MojoAuth if you want users to recover their settings on another device. It is optional for phone use and sharing. [Setup guide →](docs/MOJOAUTH.md)

## Guides

| I want to… | Start here |
|---|---|
| Try the phone and make a first connection | [Getting started](docs/GETTING_STARTED.md) |
| Deploy it on my own infrastructure | [Node hosting](examples/node-host/README.md) |
| Connect my ElevenLabs agent | [Voice setup](docs/VOICE.md) |
| Send a test phone to someone | [Shared test links](docs/SHARING.md) |
| Implement a webhook or reply callback | [API reference](docs/API.md), [OpenAPI](public/openapi.json) |
| Understand delivery and networking | [Operations](docs/OPERATIONS.md) |
| Add an adapter or contribute a fix | [Contributing](CONTRIBUTING.md) |

## Hosting and limits

The source is free under the MIT license. You pay for your chosen hosting, database and voice-provider usage. For a shared phone, voice usage belongs to the person who configured the integration.

The default Live allowance is **20 new sessions per webhook per UTC day**, shared across browsers and re-registrations. Messages within an existing session do not consume additional session slots. A test link's total call allowance is an additional limit. Self-hosters can configure the deployment limits in [.env.example](.env.example).

Public deployments use HTTPS. Webhook delivery requires supported public-only outbound networking or the provided Node startup that pins connections to checked public addresses. Unsupported deployments leave webhook delivery disabled; an HTTPS page alone does not enable the backend. See the [hosting guide](examples/node-host/README.md).

## Source download and development

The repository and included examples are MIT licensed. Running the demo or build regenerates a source ZIP, available from the app's Docs tab at `/downloads/browser-phone-source.zip`. Generate it separately with `npm run build:source`. Its allowlist excludes real environment files, credentials, Git history and installed dependencies.

```sh
npm test
npx tsc --noEmit
npm run build:node
```

The standard test suite includes offline, UI and local SQL/protocol checks. Live database suites require a dedicated test database and skip without its configuration. Tests do not establish a working real provider call. See [Contributing](CONTRIBUTING.md), [Security](SECURITY.md) and the [recorded verification](RELEASE-REVIEW.md).
