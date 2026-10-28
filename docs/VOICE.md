# Bring your own voice

Browser Phone supplies the interface. You supply the voice agent, provider account and integration. ElevenLabs is the included adapter; other providers can be added through the adapter interface.

## Public agent ID

Enter your public ElevenLabs agent ID in the Live panel. An agent ID identifies the agent and is not an API key. Browser Phone uses the provider SDK to connect from the browser. Your provider's access rules and account limits still apply.

This is a standalone voice path. Shared test links currently use a paired webhook connection, so use the private-agent/webhook flow when you want managed test links.

## Private agent through your webhook

The setup owner connects their own app's public HTTPS webhook. That app keeps the permanent ElevenLabs key on its server.

```text
Tester opens the phone and presses Call
  → Browser Phone sends a signed call.start event to the owner's webhook
  → The owner's server requests a temporary signed URL from ElevenLabs
  → The webhook returns the voice response below
  → The browser connects directly to ElevenLabs for live audio
```

Your webhook responds to `call.start` with:

```json
{
  "voice": {
    "provider": "elevenlabs",
    "transport": "websocket",
    "signed_url": "<signed URL returned by ElevenLabs>"
  }
}
```

The [Node webhook example](../examples/node-webhook/README.md) implements this flow. Set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` on that server only. A generic messaging webhook needs this extra voice handler; ElevenLabs notification webhooks serve a different purpose.

The returned URL must use `wss://api.elevenlabs.io/v1/convai/conversation` with `agent_id` and either `conversation_signature` or the legacy `token` parameter. The app rejects other destinations, additional query fields and opaque third-party WebRTC credentials. Return the provider's URL unchanged; do not construct a credential URL in the public browser.

Official reference: [ElevenLabs agent authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication).

## Shared links and credentials

The person configuring the integration owns the webhook and provider account. A tester needs no provider credentials: their test link grants limited access to that integration. Calls use the setup owner's provider allowance or credits, including when someone forwards the link.

Permanent provider keys stay on the owner's backend. Browser Phone does handle temporary voice URLs and the browser handles microphone audio. Use a deployment you trust, or self-host it. The webhook carries signaling and text; audio flows directly between the browser and ElevenLabs.

A link's call allowance limits Browser Phone call attempts. Previously issued provider credentials retain the provider's validity, so use provider-side controls if you need an absolute provider budget or duration limit. Revoking a link blocks subsequent Browser Phone operations and active clients stop on their next check; it cannot forcibly recall a provider credential already issued.

## Troubleshooting

| Symptom | Check |
|---|---|
| Webhook controls are disabled | The phone backend must support safe outbound delivery; follow the [Node hosting guide](../examples/node-host/README.md) |
| Messages work but voice fails | Handle `call.start` and return the voice response, not only a text reply |
| Voice configuration is rejected | Return the documented signed WebSocket URL unchanged; check the accepted host, path and query fields above |
| Microphone is unavailable | Open the public phone over HTTPS, allow browser microphone access, and check device permissions; localhost is the development exception |
| The shared phone has no calls left | Its total call-attempt allowance is exhausted; the owner can issue a new link subject to the daily allowance |
| A shared call fails after starting | The reserved attempt still counts; it is not silently replaced with a simulated success |

Real provider audio must be tested on the configured deployment. The project's local tests validate protocol and lifecycle behavior, not a real ElevenLabs call.

## Add another provider

Implement `VoiceAdapter` in [src/lib/voice/adapter.ts](../src/lib/voice/adapter.ts) and register it in `voiceAdapters`. Preserve user-initiated microphone access, session cleanup, credential redaction and validated connection destinations. See [Contributing](../CONTRIBUTING.md).
