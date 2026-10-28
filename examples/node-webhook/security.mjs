import crypto from 'node:crypto';
export function verify(raw, header, secret, now = Date.now()) {
  if (!secret || typeof header !== 'string') return false;
  const m = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(header);
  if (!m || !Number.isFinite(Number(m[1])) || Math.abs(now / 1000 - Number(m[1])) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${m[1]}.${raw}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(m[2], 'hex'));
}
export function callbackUrl(evt, origin) {
  const base = new URL(origin);
  const u = new URL(evt.reply_url);
  if (base.protocol !== 'https:' || base.origin !== origin || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(evt.session_id || '') ||
      u.protocol !== 'https:' || u.origin !== base.origin || u.username || u.password || u.hash || u.search ||
      u.pathname !== `/api/public/v1/sessions/${evt.session_id}/messages` || !/^bp_cb_[A-Za-z0-9_-]{8,}$/.test(evt.callback_token || '')) throw new Error('Invalid callback');
  return u.toString();
}
export async function readBody(req, limit = 16384) {
  const chunks = []; let bytes = 0;
  for await (const c of req) { bytes += c.length; if (bytes > limit) { const e = new Error('Body too large'); e.status = 413; throw e; } chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
