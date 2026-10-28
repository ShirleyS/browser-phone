// Node 20+. See README: unsigned pairing is bootstrap-only, never outbound.
import http from 'node:http';
import { verify, callbackUrl, readBody } from './security.mjs';
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.BP_SIGNING_SECRET || '';
const ORIGIN = process.env.BP_PHONE_ORIGIN || '';
const seen = new Set(); // Persist successful event IDs in a database in production.
async function reply(evt, url) {
  const r = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${evt.callback_token}` },
    body: JSON.stringify({ id: `reply-${evt.id}`, type: 'message', text: `You said: ${evt.data.text}` }) });
  await r.body?.cancel();
  if (!r.ok) throw new Error(`Callback HTTP ${r.status}`);
}
async function signedUrl() {
  const { ELEVENLABS_API_KEY: key, ELEVENLABS_AGENT_ID: agent } = process.env;
  if (!key || !agent) return null;
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agent)}`, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'xi-api-key': key } });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const raw = await readBody(r.body);
  return JSON.parse(raw).signed_url;
}
http.createServer(async (req, res) => {
  const send = (status, obj) => { if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj)); };
  try {
    if (req.method !== 'POST') return send(405, {});
    const raw = await readBody(req);
    let evt; try { evt = JSON.parse(raw); } catch { return send(400, { error: 'Malformed JSON' }); }
    if (!evt || typeof evt !== 'object' || typeof evt.id !== 'string' || evt.id.length > 128) return send(400, {});
    if (evt.type === 'connection.pairing') {
      // No outbound action, token handling or event deduplication during bootstrap.
      if (typeof evt.code === 'string' && /^[A-Z2-9]{8}$/.test(evt.code)) console.log(`Browser Phone pairing code: ${evt.code}`);
      return send(200, {});
    }
    if (!verify(raw, req.headers['x-browserphone-signature'], SECRET)) return send(401, { error: 'Signature required' });
    if (!['message.sent', 'call.start', 'call.end'].includes(evt.type)) return send(400, {});
    const url = callbackUrl(evt, ORIGIN); // All non-pairing events validate destinations before work.
    if (evt.type === 'message.sent' && (typeof evt.data?.text !== 'string' || evt.data.text.length > 4000)) return send(400, {});
    if (seen.has(evt.id)) return send(200, {});
    if (seen.size >= 10000) return send(503, { error: 'Example dedupe capacity reached; restart or use persistent storage' });
    seen.add(evt.id);
    if (evt.type === 'message.sent') {
      send(200, {});
      setTimeout(() => { void reply(evt, url).catch(() => { seen.delete(evt.id); console.error('Delayed callback failed (no credentials logged)'); }); }, 100);
      return;
    }
    const urlVoice = evt.type === 'call.start' ? await signedUrl() : null;
    return send(200, urlVoice ? { voice: { provider: 'elevenlabs', transport: 'websocket', signed_url: urlVoice } } : {});
  } catch (e) { send(e.status || 400, { error: 'Rejected request' }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Browser Phone webhook on :${PORT}`));
