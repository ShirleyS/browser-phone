import { useEffect, useState } from "react";

function Code({ children }: { children: string }) {
  return <pre className="overflow-auto rounded-lg bg-phone-frame p-3 text-[11px] leading-relaxed text-call-foreground">{children}</pre>;
}

export function Docs() {
  const [base, setBase] = useState("/api/public/v1");
  useEffect(() => setBase(`${window.location.origin}/api/public/v1`), []);
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <section className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Base URL</h3>
        <p className="mt-1 text-muted-foreground">All endpoints live under this exact prefix (the hosting platform routes public APIs through <code>/api/public</code>):</p>
        <code className="mt-2 block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">{base}</code>
        <a href="/downloads/browser-phone-source.zip" download className="mt-3 inline-flex items-center rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Download source (.zip, MIT)</a>
        <p className="mt-1 text-[11px] text-muted-foreground">Built reproducibly from an allowlist by <code>npm run build:source</code>. No secrets, .env, .git or node_modules. <a className="underline" href="/downloads/browser-phone-source.files.txt" target="_blank" rel="noreferrer">File list</a>.</p>
        <p className="mt-2 text-xs text-muted-foreground">Machine-readable spec: <a className="text-primary underline" href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a> (OpenAPI 3.1).</p>
      </section>

      <section className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="font-semibold">Flow</h3>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li><b>POST /connections</b> {"{webhook_url}"} → phone token + signing secret. A one-time pairing code is POSTed <i>only</i> to your webhook.</li>
          <li><b>POST /connections/{"{id}"}/verify</b> {"{code}"} with the phone token.</li>
          <li><b>POST /connections/{"{id}"}/sessions</b> with <code>Idempotency-Key</code> → session phone token. Counts against the daily allowance (default 20 / webhook / UTC day).</li>
          <li>The phone posts <b>call.start</b>, <b>call.end</b>, <b>message.sent</b> to <b>/sessions/{"{id}"}/events</b>; we forward each to your webhook, signed.</li>
          <li>Your app replies to <code>reply_url</code> with <code>Authorization: Bearer &lt;callback_token&gt;</code>. The phone reads its inbox with cursor polling.</li>
        </ol>
      </section>

      <section className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="font-semibold">What your webhook receives</h3>
        <Code>{`POST <your webhook>
X-BrowserPhone-Event: message.sent
X-BrowserPhone-Signature: t=1767225600,v1=<hex HMAC-SHA256(signing_secret, t + "." + rawBody)>

{
  "id": "m-6f0c…",              // unique event id — dedupe on it
  "type": "message.sent",       // or call.start / call.end / connection.pairing
  "session_id": "…",
  "session_kind": "chat",
  "reply_url": "${base}/sessions/<id>/messages",
  "callback_token": "bp_cb_…",  // per-session, only sent to your webhook
  "data": { "text": "Where is my order?" }
}`}</Code>
        <p className="text-muted-foreground">Respond 2xx. Optionally include an inline reply, or (for <code>call.start</code>) a voice config:</p>
        <Code>{`{ "reply": { "text": "On its way!" } }

{ "voice": { "provider": "elevenlabs", "transport": "websocket", "signed_url": "wss://…" } }
{ "voice": { "provider": "elevenlabs", "agent_id": "agent_…" } }`}</Code>
        <p className="text-xs text-muted-foreground">Mint signed URLs on your server with your own ElevenLabs key. The agent owns its tools and billing; audio flows browser ↔ ElevenLabs directly. The webhook carries signaling and text only, never audio.</p>
      </section>

      <section className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="font-semibold">Replying later</h3>
        <Code>{`curl -X POST "$REPLY_URL" \\
  -H "Authorization: Bearer $CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"unique-id","type":"message","text":"Your order is ready",
       "link":{"label":"View receipt","url":"https://example.com/receipt"}}'`}</Code>
        <p className="text-xs text-muted-foreground">Duplicate <code>id</code>s are accepted once. Messages are stored, so they arrive even if sent before the phone polls. Tokens go in headers only, never in query strings.</p>
      </section>

      <section className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="font-semibold">Verify signatures (Node)</h3>
        <Code>{`import crypto from "node:crypto";
function verify(raw, header, secret, toleranceSec = 300) {
  if (!secret || typeof header !== "string") return false;
  const m = /^t=(\\d{1,12}),v1=([a-f0-9]{64})$/.exec(header);
  if (!m || !Number.isFinite(Number(m[1])) || Math.abs(Date.now()/1000 - Number(m[1])) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(\`\${m[1]}.\${raw}\`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(m[2], "hex"));
}`}</Code>
      </section>

      <section className="rounded-xl border bg-card p-4 space-y-1 text-muted-foreground">
        <h3 className="font-semibold text-foreground">Limits & errors</h3>
        <p>429 <code>quota_exceeded</code> includes <code>reset_at</code> and <code>Retry-After</code>. Other errors: 400 invalid_request, 401 unauthorized, 403 not_verified, 409 session_ended / idempotency_replay, 410 session_expired, 413 payload_too_large, 422 invalid_webhook_url, 502 when your webhook fails (the real status is reported — never a fake success).</p>
        <p>Token scopes: <code>bp_conn_</code> connection token (verify, sessions, usage, revoke; expires in 7 days; revoke with POST /connections/{"{id}"}/revoke) · <code>bp_phone_</code> one session's events + inbox · <code>bp_cb_</code> sent only to your webhook, posts into one session. All end when the session expires or the connection is revoked.</p>
        <p>Webhooks must be public HTTPS. Live delivery requires verified public-only egress or the pinned Node self-host startup (npm run build:node, then npm run start:node). Hosted networking remains unverified. Inbox pages fit within 60,000 UTF-8 bytes including the envelope. DNS prechecks alone do not protect against split resolvers or rebinding. Redirects are not followed.</p>
        <p>Signed WebSocket voice is restricted to api.elevenlabs.io/v1/convai/conversation; opaque WebRTC tokens and unverified regional WebSocket hosts are rejected. Configure provider-side call duration and budget limits: hostile browsers can ignore local timers.</p>
        <p>Connection/phone tokens are hash-only. Callback tokens, webhook signing secrets, webhook URL credentials, and successful voice responses are recoverable in the service-only database; protect database access and backups as secrets. Webhook receivers must deduplicate stable event IDs; retry after failures or a 30-second stuck-delivery lease.</p>
      </section>
    </div>
  );
}
