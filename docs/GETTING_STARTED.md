# Getting started

Browser Phone gives your app a testing phone and a link you can send to other people. Start with the offline demo, then connect a real backend when you need live replies or voice.

## 1. Try the phone

Install Node 22.12+ and npm, then:

```sh
git clone https://github.com/ShirleyS/browser-phone.git
cd browser-phone
npm ci
npm run demo
```

Open the address printed in your terminal. Send a message, try the Scenarios tab, and answer a simulated incoming call. These features require no database, provider credentials or signup.

While the saved-setup and sharing additions are awaiting merge in [PR #1](https://github.com/ShirleyS/browser-phone/pull/1), use its feature branch to try them:

```sh
git fetch origin codex/optional-mojoauth
git switch --track origin/codex/optional-mojoauth
npm ci
npm run demo
```

These branch-selection commands assume a fresh clone with no local edits.

## 2. Choose a real integration

| What you want to test | What you need |
|---|---|
| A public ElevenLabs agent on your own phone page | Your public agent ID and a supported browser; provider access rules still apply |
| Your app receiving messages and sending replies | A Live-capable phone backend, its database, and your public HTTPS webhook |
| A private ElevenLabs agent through your app | The webhook path above, plus your ElevenLabs credentials on your backend |
| A shared phone using your existing integration | A verified webhook connection and the sharing migration |

A public agent ID alone does not create the paired connection needed for managed test links. [Voice setup](VOICE.md) explains the two voice paths.

## 3. Start a Live-capable phone backend

Follow the [Node hosting guide](../examples/node-host/README.md). It covers the database, migration order, secret settings and HTTPS. Keep credentials in the deployment's secret manager.

After startup, `GET /api/public/v1/connections` should report `enabled: true` and `transport: "node-pinned"` for the provided Node path. A disabled capability means the deployment cannot deliver webhooks yet. The Connect panel explains this state.

A local development server and a published frontend are not proof that this backend is configured. The current public service has not been verified; use your own deployment for Live integration work.

## 4. Pair your webhook

Use the [Node webhook example](../examples/node-webhook/README.md), adapt the [n8n example](../examples/n8n/README.md), or implement the [API contract](API.md).

1. Give your webhook a public HTTPS URL and configure it with the phone's exact public origin.
2. In the phone, select **Connect → Live**, enter the webhook URL and register it.
3. Read the pairing code delivered to your webhook and enter it in the phone. The sample prints it in its private server console.
4. Configure your webhook with the signing secret shown at registration so it can verify subsequent events.
5. Send a message. Your webhook receives `message.sent`; its reply should appear in the phone.

This proves webhook ownership without an account login. Do not paste your ElevenLabs API key into the phone.

## 5. Test voice

For a private agent, set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` in your webhook server's secret settings. The sample handles `call.start` by requesting a temporary signed URL and returning the expected voice response. The phone asks for microphone permission after you start a call, then connects directly to ElevenLabs.

Make one real call and verify both directions of audio on your deployed setup. [Voice troubleshooting](VOICE.md#troubleshooting) covers common failures.

## 6. Share a test phone

Open **Share a test phone**, choose one, three, five or a custom number of call attempts, set an expiry and copy the link. Your tester needs only that complete link. They get a separate conversation while using your integration and provider account. Forwarded links share the same total allowance.

See the [sharing guide](SHARING.md) for expiry, revocation and counting rules. Configure [optional saved setups](MOJOAUTH.md) only if you want account-based recovery across devices.
