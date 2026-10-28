# Caller phone controlled by an existing app

The `/integration` page is a phone-only caller interface for apps that already own their voice connection. Ring Orden keeps its authenticated ElevenLabs connection in the dashboard; the phone controls that same connection. This avoids starting two independent voice sessions or sending a permanent API key to the phone.

Open it in an iframe or a dashboard-created popup with `parent_origin` and a random `session` nonce. The phone accepts messages only from its actual parent/opener, the exact declared origin, and the matching session. It sends `ready` and waits for an explicit `configure` command; it never automatically calls or falls back to a simulated call. Browser storage is isolated from owner configurations.

All envelopes use `{protocol:"browser-phone",v:1,session,type,...payload}`. Parent commands:

- `configure`: `{contact:{name,number},lang:"en"|"es"}`.
- `call.state`: `{status:"idle"|"connecting"|"active"|"ended"|"error",error?}` from the actual provider state.
- `message.received`: `{id,text,link?:{label,url}}`, with HTTPS links, for real messages only.
- `message.ack`: `{id,ok}` to resolve a tester's pending text.

Phone requests: `call.request`, `call.end.request`, `call.mute.request` with `muted`, `call.volume.request` with `volume`, and `message.request` with `id,text`. Acknowledge only an actual successful send. Voice transcripts do not automatically become chat messages. Order, payment, receipt or document links must be sent explicitly by the integration.

The fake display number identifies no provider account or destination. Show the configured phone origin, bridge instance and actual connection status in the dashboard. A link alone does not establish voice. The dashboard must remain open and configured to host its voice session.

This protocol is implemented in source. Real deployed audio and notification delivery still need end-to-end verification; a successful handshake does not prove the provider or message sender is working.
