import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";
import { assertPublicWebhook } from "@/lib/shared/net";
import { validVoiceConfig } from '@/lib/voice/validate';
import { inboxPage } from './inbox-page';
import {
  admin, apiBase, apiError, bearer, deliverWebhook, dohResolver, getConfig, json, pairingCode,
  randomToken, readJson, safeEqual, sha256Hex, liveCapability, webhookResolver,
} from "./core";

const uuid = z.string().uuid();
const extId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const linkSchema = z.object({ label: z.string().min(1).max(80), url: z.string().url().max(2048).refine((u) => u.startsWith("https://"), "https only") });

async function loadConnection(request: Request, id: string) {
  if (!uuid.safeParse(id).success) return { res: apiError(404, "not_found", "Connection not found") } as const;
  const tok = bearer(request);
  if (!tok) return { res: apiError(401, "unauthorized", "Missing bearer phone token") } as const;
  const db = await admin();
  const { data } = await db.from("bp_connections").select("*").eq("id", id).maybeSingle();
  if (!data || !safeEqual(data.phone_token_hash, await sha256Hex(tok))) return { res: apiError(401, "unauthorized", "Invalid token for this connection") } as const;
  if (data.revoked_at) return { res: apiError(401, "token_revoked", "This connection was revoked") } as const;
  if (new Date(data.token_expires_at).getTime() < Date.now()) return { res: apiError(401, "token_expired", "Connection token expired; register again") } as const;
  return { db, conn: data } as const;
}

async function loadSession(request: Request, id: string, which: "phone" | "callback") {
  if (!uuid.safeParse(id).success) return { res: apiError(404, "not_found", "Session not found") } as const;
  const tok = bearer(request);
  if (!tok) return { res: apiError(401, "unauthorized", "Missing bearer token") } as const;
  const db = await admin();
  const { data } = await db.from("bp_sessions").select("*, bp_connections(webhook_url, signing_secret, fingerprint, revoked_at)").eq("id", id).maybeSingle();
  const hash = await sha256Hex(tok);
  const expected = data ? (which === "phone" ? data.phone_token_hash : data.callback_token_hash) : "";
  if (!data || !safeEqual(expected, hash)) return { res: apiError(401, "unauthorized", "Invalid token for this session") } as const;
  if ((data.bp_connections as { revoked_at: string | null } | null)?.revoked_at) return { res: apiError(401, "token_revoked", "Connection was revoked") } as const;
  if (new Date(data.expires_at).getTime() < Date.now()) return { res: apiError(410, "session_expired", "Session expired") } as const;
  return { db, sess: data } as const;
}

// POST /v1/connections
export async function createConnection(request: Request) {
  const cfg = getConfig();
  if (!liveCapability(cfg).enabled) return apiError(503, 'egress_not_enforced', 'Live webhooks require an enforced public-only egress boundary or pinned Node startup');
  const body = await readJson(request, cfg.maxBodyBytes);
  if (!body.ok) return body.res;
  const p = z.object({ webhook_url: z.string().max(2048) }).safeParse(body.data);
  if (!p.success) return apiError(400, "invalid_request", "webhook_url is required");
  const check = await assertPublicWebhook(p.data.webhook_url, webhookResolver(cfg));
  if (!check.ok) return apiError(422, "invalid_webhook_url", `Webhook URL rejected: ${check.reason}`, { reason: check.reason });
  const db = await admin();
  const { data: allowed } = await db.rpc("bp_bump_usage", { _fp: check.fingerprint, _kind: "pairing", _limit: cfg.dailyPairingLimit });
  if (!allowed) return quota429("Too many pairing attempts for this webhook today");

  const phoneToken = randomToken("bp_conn_");
  const signingSecret = randomToken("whsec_", 24);
  const code = pairingCode();
  const expires = new Date(Date.now() + 15 * 60_000).toISOString();
  const { data: conn, error } = await db
    .from("bp_connections")
    .insert({ webhook_url: check.url.toString(), fingerprint: check.fingerprint, phone_token_hash: await sha256Hex(phoneToken), signing_secret: signingSecret, pairing_code_hash: await sha256Hex(code), pairing_expires_at: expires, token_expires_at: new Date(Date.now() + cfg.connectionTokenTtlSeconds * 1000).toISOString() })
    .select("id, created_at, token_expires_at")
    .single();
  if (error || !conn) return apiError(500, "internal_error", "Could not create connection");

  const delivery = await deliverWebhook(cfg, check.url.toString(), signingSecret, "connection.pairing", {
    id: `pair_${conn.id}`, type: "connection.pairing", connection_id: conn.id, code, expires_at: expires,
    instructions: "Enter this code in Browser Phone to prove you own this webhook.",
  });
  return json({
    id: conn.id,
    status: "pending_verification",
    api_base: apiBase(request, cfg),
    phone_token: phoneToken,
    phone_token_expires_at: conn.token_expires_at,
    signing_secret: signingSecret,
    pairing: { delivered: delivery.ok, status: delivery.status, latency_ms: delivery.latency_ms, error: delivery.error, expires_at: expires },
  }, 201);
}

// POST /v1/connections/{id}/verify
export async function verifyConnection(request: Request, id: string) {
  const cfg = getConfig();
  const l = await loadConnection(request, id);
  if ("res" in l) return l.res;
  const body = await readJson(request, cfg.maxBodyBytes);
  if (!body.ok) return body.res;
  const p = z.object({ code: z.string().min(4).max(16) }).safeParse(body.data);
  if (!p.success) return apiError(400, "invalid_request", "code is required");
  const { db, conn } = l;
  const { data, error } = await db.rpc('bp_verify_pairing', { _connection_id: id, _candidate_hash: await sha256Hex(p.data.code.trim().toUpperCase()) });
  if (error || !data) return apiError(500, 'internal_error', 'Could not verify pairing');
  const result = data as { error?: string; attempts_left?: number; verified_at?: string };
  if (result.error) return apiError(result.error === 'too_many_attempts' ? 429 : result.error === 'pairing_expired' ? 410 : 401, result.error, 'Pairing verification rejected', { attempts_left: result.attempts_left });
  return json({ id: conn.id, status: 'verified', verified_at: result.verified_at });
}

function quota429(message: string, extra: Record<string, unknown> = {}) {
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const retry = Math.max(1, Math.ceil((reset.getTime() - now.getTime()) / 1000));
  return apiError(429, "quota_exceeded", message, { reset_at: reset.toISOString(), ...extra }, { "Retry-After": String(retry) });
}

// POST /v1/connections/{id}/sessions
export async function createSession(request: Request, id: string) {
  const cfg = getConfig();
  const l = await loadConnection(request, id);
  if ("res" in l) return l.res;
  const body = await readJson(request, cfg.maxBodyBytes);
  if (!body.ok) return body.res;
  const p = z.object({ kind: z.enum(["chat", "call"]).default("chat"), idempotency_key: extId.optional() }).safeParse(body.data);
  if (!p.success) return apiError(400, "invalid_request", "kind must be chat or call");
  const idem = request.headers.get("idempotency-key") || p.data.idempotency_key;
  if (!idem || !extId.safeParse(idem).success) return apiError(400, "idempotency_key_required", "Provide an Idempotency-Key header (1-128 safe chars)");
  const phoneToken = randomToken("bp_phone_");
  const callbackToken = randomToken("bp_cb_");
  const { data, error } = await l.db.rpc("bp_create_session", {
    _connection_id: id, _kind: p.data.kind, _idem: idem,
    _phone_hash: await sha256Hex(phoneToken), _callback_hash: await sha256Hex(callbackToken),
    _daily_limit: cfg.dailySessionLimit, _max_concurrent: cfg.maxConcurrentSessions,
    _ttl_seconds: cfg.sessionTtlSeconds, _max_call_seconds: cfg.maxCallSeconds,
  });
  if (error || !data) return apiError(500, "internal_error", "Could not create session");
  const r = data as { error?: string; replay?: boolean; id: string; kind: string; expires_at: string; call_deadline: string | null; used: number; limit: number };
  if (r.error === "not_verified") return apiError(403, "not_verified", "Verify webhook ownership first");
  if (r.error === "too_many_concurrent") return apiError(429, "too_many_concurrent", `At most ${cfg.maxConcurrentSessions} active sessions per webhook`, {}, { "Retry-After": "30" });
  if (r.error === "quota_exceeded") return quota429(`Daily limit of ${cfg.dailySessionLimit} new sessions reached for this webhook`, { limit: cfg.dailySessionLimit });
  if (r.error) return apiError(404, "not_found", "Connection not found");
  if (r.replay) {
    // Idempotent retry: no extra quota. Issue a fresh phone token (old one stops working);
    // the callback token already given to the webhook is kept.
    await l.db.from("bp_sessions").update({ phone_token_hash: await sha256Hex(phoneToken) }).eq("id", r.id);
  } else {
    await l.db.from("bp_sessions").update({ callback_token: callbackToken }).eq("id", r.id);
  }
  const base = apiBase(request, cfg);
  const { data: sessionRow } = await l.db.from('bp_sessions').select('call_deadline').eq('id', r.id).single();
  return json({
    id: r.id, kind: r.kind, expires_at: r.expires_at, call_deadline: sessionRow?.call_deadline ?? r.call_deadline ?? null,
    phone_token: phoneToken,
    idempotent_replay: !!r.replay,
    usage: r.replay ? null : { used: r.used, limit: r.limit },
    endpoints: { events: `${base}/sessions/${r.id}/events`, messages: `${base}/sessions/${r.id}/messages` },
  }, r.replay ? 200 : 201);
}

// GET /v1/connections/{id}/usage
export async function getUsage(request: Request, id: string) {
  const cfg = getConfig();
  const l = await loadConnection(request, id);
  if ("res" in l) return l.res;
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await l.db.from("bp_usage").select("count").eq("fingerprint", l.conn.fingerprint).eq("day", day).eq("kind", "session").maybeSingle();
  const used = data?.count ?? 0;
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return json({ connection_id: id, verified: !!l.conn.verified_at, day, used, limit: cfg.dailySessionLimit, remaining: Math.max(0, cfg.dailySessionLimit - used), reset_at: reset.toISOString(), limits: { max_concurrent_sessions: cfg.maxConcurrentSessions, session_ttl_seconds: cfg.sessionTtlSeconds, max_call_seconds: cfg.maxCallSeconds } });
}

const voiceSchema = z.union([
  z.object({ provider: z.literal("elevenlabs"), transport: z.literal("websocket"), signed_url: z.string().max(4096).refine((u) => u.startsWith("wss://"), "wss only") }),
  z.object({ provider: z.literal("elevenlabs"), transport: z.literal("webrtc"), conversation_token: z.string().min(8).max(4096) }),
  z.object({ provider: z.literal("elevenlabs"), agent_id: z.string().min(4).max(128), transport: z.enum(["websocket", "webrtc"]).optional() }),
]);
const inlineReply = z.object({ id: extId.optional(), text: z.string().max(4000).optional(), link: linkSchema.optional() });

// POST /v1/sessions/{id}/events  (phone -> app)
export async function postEvent(request: Request, id: string) {
  const cfg = getConfig();
  const l = await loadSession(request, id, "phone");
  if ("res" in l) return l.res;
  const body = await readJson(request, cfg.maxBodyBytes);
  if (!body.ok) return body.res;
  const p = z.object({ id: extId, type: z.enum(["call.start", "call.end", "message.sent"]), text: z.string().max(4000).optional() }).safeParse(body.data);
  if (!p.success) return apiError(400, "invalid_request", "Event needs id, type (call.start|call.end|message.sent)");
  const { db, sess } = l;
  const ev = p.data;
  if (sess.status !== "active" && ev.type !== "call.end") return apiError(409, "session_ended", "Session already ended");
  if (ev.type.startsWith("call.") && sess.kind !== "call") return apiError(409, "wrong_session_kind", "Call events need a call session");
  if (ev.type === "message.sent" && !ev.text) return apiError(400, "invalid_request", "message.sent requires text");
  if (sess.call_deadline && ev.type !== "call.end" && new Date(sess.call_deadline).getTime() < Date.now())
    return apiError(409, "call_duration_exceeded", "Max call duration reached");

  const lease = crypto.randomUUID();
  const { data: claimData, error: claimError } = await db.rpc('bp_claim_event', { _session_id: id, _event_id: ev.id, _type: ev.type, _request: ev, _lease: lease });
  if (claimError || !claimData) return apiError(500, 'internal_error', 'Could not claim event');
  const claim = claimData as { claimed?: boolean; cached?: boolean; pending?: boolean; conflict?: boolean; response?: unknown; status?: number };
  if (claim.conflict) return apiError(409, 'idempotency_conflict', 'Event ID already used for different content');
  if (claim.cached) return json(claim.response, claim.status ?? 200);
  if (claim.pending || !claim.claimed) return apiError(409, 'delivery_pending', 'Delivery in progress; retry this same event ID', {}, { 'Retry-After': '2' });
  if (ev.type === 'message.sent') {
    const { error } = await db.rpc('bp_insert_message', { _session_id: id, _external_id: ev.id, _direction: 'phone_to_app', _type: 'message', _text: ev.text ?? '', _link: null });
    if (error) {
      await db.rpc('bp_finish_event', { _session_id: id, _event_id: ev.id, _lease: lease, _ok: false, _response: {}, _status: 500 });
      return apiError(500, 'internal_error', 'Could not store outbound message');
    }
  }

  const conn = sess.bp_connections as unknown as { webhook_url: string; signing_secret: string };
  const base = apiBase(request, cfg);
  const callbackToken = sess.callback_token as string;
  const payload = {
    id: ev.id, type: ev.type, created_at: new Date().toISOString(), session_id: id, session_kind: sess.kind,
    reply_url: `${base}/sessions/${id}/messages`, callback_token: callbackToken,
    data: ev.text ? { text: ev.text } : {},
  };
  const d = await deliverWebhook(cfg, conn.webhook_url, conn.signing_secret, ev.type, payload);

  let voice: unknown = null;
  let inline: string | null = null;
  let contractError: string | null = null;
  if (d.ok && d.body && typeof d.body === "object") {
    const b = d.body as { voice?: unknown; reply?: unknown };
    if (ev.type === "call.start" && b.voice) {
      const v = voiceSchema.safeParse(b.voice);
      if (v.success && validVoiceConfig(v.data)) voice = v.data;
      else contractError = "invalid_voice_config";
    }
    if (b.reply) {
      const r = inlineReply.safeParse(b.reply);
      if (r.success && (r.data.text || r.data.link)) {
        const rid = r.data.id || `inline-${ev.id}`;
        const { error } = await db.rpc('bp_insert_message', { _session_id: id, _external_id: rid, _direction: 'app_to_phone', _type: 'message', _text: r.data.text ?? '', _link: r.data.link ?? null });
        if (error) contractError = 'reply_storage_failed';
        else inline = rid;
      } else contractError = "invalid_reply";
    }
  }
  const response = {
    event_id: ev.id,
    delivery: { ok: d.ok, status: d.status, latency_ms: d.latency_ms, error: d.error },
    response_preview: d.body,
    voice, inline_reply_id: inline, contract_error: contractError,
  };
  const status = d.ok ? 200 : 502;
  const { data: finished, error: finishError } = await db.rpc('bp_finish_event', { _session_id: id, _event_id: ev.id, _lease: lease, _ok: d.ok, _response: JSON.parse(JSON.stringify(response)) as Json, _status: status });
  if (finishError || !finished) return apiError(503, 'delivery_unconfirmed', 'Delivery result could not be committed; retry the same event ID');
  if (ev.type === 'call.end' && d.ok) await db.from('bp_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id);
  return json(response, status);
}

// POST /v1/sessions/{id}/messages (app -> phone, callback token)
export async function postAppMessage(request: Request, id: string) {
  const cfg = getConfig();
  const l = await loadSession(request, id, "callback");
  if ("res" in l) return l.res;
  const body = await readJson(request, cfg.maxBodyBytes);
  if (!body.ok) return body.res;
  const p = z.object({ id: extId, type: z.literal("message").default("message"), text: z.string().max(4000).optional(), link: linkSchema.optional() }).safeParse(body.data);
  if (!p.success || (!p.data.text && !p.data.link)) return apiError(400, "invalid_request", "Message needs id and text or link (https)");
  const { data, error } = await l.db.rpc('bp_insert_message', { _session_id: id, _external_id: p.data.id, _direction: 'app_to_phone', _type: 'message', _text: p.data.text ?? '', _link: p.data.link ?? null });
  if (error || !data) return apiError(500, 'internal_error', 'Could not store message');
  const r = data as { seq: number; duplicate: boolean };
  return json({ id: p.data.id, duplicate: r.duplicate, cursor: String(r.seq) }, r.duplicate ? 200 : 201);
}

// GET /v1/sessions/{id}/messages?after=cursor (phone inbox)
export async function listMessages(request: Request, id: string) {
  const l = await loadSession(request, id, "phone");
  if ("res" in l) return l.res;
  const after = new URL(request.url).searchParams.get("after") || "0";
  if (!/^\d{1,18}$/.test(after)) return apiError(400, "invalid_cursor", "after must be a numeric cursor");
  const { data, error } = await l.db.from("bp_messages").select("seq, external_id, type, text, link, created_at").eq("session_id", id).eq("direction", "app_to_phone").gt("seq", Number(after)).order("seq").limit(50);
  if (error) return apiError(500, 'inbox_unavailable', 'Could not read inbox');
  const rows = data || [];
  return json(inboxPage(rows, after, { status: l.sess.status, expires_at: l.sess.expires_at }));
}

// POST /v1/connections/{id}/revoke — revokes the connection token, ends all its sessions
export async function revokeConnection(request: Request, id: string) {
  const l = await loadConnection(request, id);
  if ("res" in l) return l.res;
  const now = new Date().toISOString();
  await l.db.from("bp_connections").update({ revoked_at: now }).eq("id", id);
  await l.db.from("bp_sessions").update({ status: "ended", ended_at: now, expires_at: now }).eq("connection_id", id).eq("status", "active");
  return json({ id, status: "revoked", revoked_at: now });
}
