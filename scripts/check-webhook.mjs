#!/usr/bin/env node
// Webhook contract compatibility check.
//   node scripts/check-webhook.mjs https://your-webhook [signing_secret]
// Sends signed sample events (fake ids, fake reply_url) and validates responses.
import crypto from "node:crypto";

const [url, secret, phoneOrigin] = process.argv.slice(2);
if (!url || !secret || !phoneOrigin) { console.error("usage: check-webhook.mjs <url> <signing-secret> <configured-phone-https-origin>"); process.exit(2); }

const voiceOk = (v) => {
  if (!v || v.provider !== "elevenlabs") return false;
  if (v.signed_url) {
    try { const u = new URL(v.signed_url); const keys = [...u.searchParams.keys()];
      return v.transport === "websocket" && u.protocol === "wss:" && u.hostname === "api.elevenlabs.io" && !u.port && !u.username && !u.password && !u.hash && u.pathname === "/v1/convai/conversation" && keys.length === 2 && new Set(keys).size === 2 && keys.every(k => ["agent_id", "token"].includes(k)) && /^[A-Za-z0-9_-]{4,128}$/.test(u.searchParams.get("agent_id") || "") && /^[A-Za-z0-9._~-]{8,4096}$/.test(u.searchParams.get("token") || "");
    } catch { return false; }
  }
  return !v.conversation_token && /^[A-Za-z0-9_-]{4,128}$/.test(v.agent_id || "");
};
let failures = 0;
const sid = crypto.randomUUID();
for (const type of ["message.sent", "call.start", "call.end"]) {
  const body = JSON.stringify({ id: `compat-${type}-${Date.now()}`, type, created_at: new Date().toISOString(), session_id: sid, session_kind: type.startsWith("call") ? "call" : "chat", reply_url: `${phoneOrigin}/api/public/v1/sessions/${sid}/messages`, callback_token: "bp_cb_compat_check_not_a_real_token", data: type === "message.sent" ? { text: "compat check" } : {} });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const start = Date.now();
  try {
    const r = await fetch(url, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", "X-BrowserPhone-Event": type, "X-BrowserPhone-Signature": `t=${t},v1=${sig}` }, body, signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - start;
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
    const problems = [];
    if (r.status >= 300 && r.status < 400) problems.push("redirects are not followed by Browser Phone");
    else if (!r.ok) problems.push(`non-2xx status ${r.status}`);
    if (ms > 8000) problems.push("slower than 8s timeout");
    if (j?.reply && !(j.reply.text || j.reply.link)) problems.push("reply needs text or link");
    if (j?.reply?.link && !/^https:\/\//.test(j.reply.link.url || "")) problems.push("reply.link.url must be https");
    if (j?.voice && !voiceOk(j.voice)) problems.push("invalid voice config");
    if (type === "call.start" && !j?.voice) console.log("  note: call.start returned no voice config → phone will run a simulated call");
    console.log(`${problems.length ? "✗" : "✓"} ${type} → ${r.status} in ${ms}ms${problems.length ? " — " + problems.join("; ") : ""}`);
    failures += problems.length ? 1 : 0;
  } catch (e) {
    console.log(`✗ ${type} → ${e.name === "TimeoutError" ? "timeout" : e.message}`);
    failures++;
  }
}
process.exit(failures ? 1 : 0);
