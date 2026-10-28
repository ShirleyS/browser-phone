// n8n Code node, Run Once for All Items. Raw binary body is mandatory.
const crypto = require('crypto');
const item = $input.first();
if (!item.binary?.data) throw new Error('Raw binary body required');
const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
if (buffer.length > 16384) throw new Error('Body too large');
const raw = buffer.toString('utf8');
const evt = JSON.parse(raw);
if (!evt || typeof evt.id !== 'string' || evt.id.length > 128) throw new Error('Invalid event');
if (evt.type === 'connection.pairing') {
  // Bootstrap is display-only; no callback, credential use, or outgoing request.
  return [{ json: { pairing_code: /^[A-Z2-9]{8}$/.test(evt.code || '') ? evt.code : '', reply: {} } }];
}
const secret = $env.BP_SIGNING_SECRET;
const header = item.json.headers?.['x-browserphone-signature'];
const m = typeof header === 'string' && /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(header);
if (!secret || !m || !Number.isFinite(Number(m[1])) || Math.abs(Date.now()/1000 - Number(m[1])) > 300) throw new Error('Signature required');
const expected = crypto.createHmac('sha256', secret).update(`${m[1]}.${raw}`).digest();
if (!crypto.timingSafeEqual(expected, Buffer.from(m[2], 'hex'))) throw new Error('Invalid signature');
const base = new URL($env.BP_PHONE_ORIGIN);
const url = new URL(evt.reply_url);
if (base.protocol !== 'https:' || base.origin !== $env.BP_PHONE_ORIGIN || url.origin !== base.origin || url.username || url.password || url.hash || url.search ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(evt.session_id || '') ||
    url.pathname !== `/api/public/v1/sessions/${evt.session_id}/messages` || !/^bp_cb_[A-Za-z0-9_-]{8,}$/.test(evt.callback_token || '')) throw new Error('Invalid callback destination');
if (!['message.sent','call.start','call.end'].includes(evt.type)) throw new Error('Invalid type');
if (evt.type === 'message.sent' && (typeof evt.data?.text !== 'string' || evt.data.text.length > 4000)) throw new Error('Invalid message');
// Inline reply avoids outbound HTTP entirely. Browser Phone deduplicates inline IDs.
return [{ json: evt.type === 'message.sent' ? { reply: { id: `n8n-${evt.id}`, text: `n8n got: ${evt.data.text}` } } : {} }];
