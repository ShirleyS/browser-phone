// Browser Phone API core: config, crypto, HTTP helpers, safe webhook delivery.
// Server-only: imported by /api/public/v1 route handlers.
import { assertPublicWebhook, type Resolver } from "@/lib/shared/net";
import { boundedText, BodyLimitError } from '@/lib/shared/body';
import { pinnedOutbound } from './outbound';

export function getConfig() {
  const n = (k: string, d: number) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
  };
  return {
    dailySessionLimit: n("BP_DAILY_SESSION_LIMIT", 20),
    dailyPairingLimit: n("BP_DAILY_PAIRING_LIMIT", 10),
    maxConcurrentSessions: n("BP_MAX_CONCURRENT_SESSIONS", 3),
    sessionTtlSeconds: n("BP_SESSION_TTL_SECONDS", 1800),
    maxCallSeconds: n("BP_MAX_CALL_SECONDS", 900),
    connectionTokenTtlSeconds: n("BP_CONNECTION_TOKEN_TTL_SECONDS", 604800),
    webhookTimeoutMs: n("BP_WEBHOOK_TIMEOUT_MS", 8000),
    maxBodyBytes: Math.min(n("BP_MAX_BODY_BYTES", 16384), 16384),
    publicOnlyEgress: process.env['BP_PUBLIC_ONLY_EGRESS'] === 'enforced',
    allowInsecureWebhooks: process.env["BP_ALLOW_INSECURE_WEBHOOKS"] === "true",
    dnsResolverUrl: process.env["BP_DNS_RESOLVER_URL"] || "https://cloudflare-dns.com/dns-query",
    publicBaseUrl: process.env["BP_PUBLIC_BASE_URL"] || "",
  };
}
export type BpConfig = ReturnType<typeof getConfig>;

export function liveCapability(cfg = getConfig()) {
  const pinned = pinnedOutbound();
  return { enabled: !!pinned || cfg.publicOnlyEgress, transport: pinned ? 'node-pinned' : cfg.publicOnlyEgress ? 'enforced-egress' : 'disabled', prerequisite: 'Verified public-only egress at connection time, or the checked-address-pinned Node startup' };
}
export function webhookResolver(cfg: BpConfig): Resolver { return pinnedOutbound()?.resolve ?? dohResolver(cfg); }

const enc = new TextEncoder();
function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function randomToken(prefix: string, bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return `${prefix}${b64url(a)}`;
}
export function pairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => alphabet[b % alphabet.length]).join("");
}
export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- HTTP ----------
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
  "Access-Control-Expose-Headers": "Retry-After",
  "Access-Control-Max-Age": "600",
};
export const preflight = () => new Response(null, { status: 204, headers: CORS });

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra },
  });
}
export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return json({ error: { code, message, ...extra } }, status, headers);
}

export function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m?.[1] ?? null;
}

export async function readJson(request: Request, max: number): Promise<{ ok: true; data: unknown } | { ok: false; res: Response }> {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > max) { await request.body?.cancel(); return { ok: false, res: apiError(413, "payload_too_large", `Body exceeds ${max} bytes`) }; }
  let text: string;
  try { text = await boundedText(request.body, max); }
  catch (e) { return { ok: false, res: apiError(e instanceof BodyLimitError ? 413 : 400, e instanceof BodyLimitError ? 'payload_too_large' : 'invalid_body', 'Request body rejected') }; }
  if (!text) return { ok: true, data: {} };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, res: apiError(400, "invalid_json", "Body must be valid JSON") };
  }
}

export function apiBase(request: Request, cfg: BpConfig) {
  const origin = cfg.publicBaseUrl.replace(/\/+$/, "") || new URL(request.url).origin;
  return `${origin}/api/public/v1`;
}

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- DNS + safe outbound fetch ----------
export function dohResolver(cfg: BpConfig): Resolver {
  return async (host) => {
    const out: string[] = [];
    for (const type of ["A", "AAAA"]) {
      const r = await fetch(`${cfg.dnsResolverUrl}?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) throw new Error("dns");
      const j = JSON.parse(await boundedText(r.body, 65536)) as { Answer?: { type: number; data: string }[] };
      for (const a of j.Answer || []) if (a.type === 1 || a.type === 28) out.push(a.data);
    }
    return out;
  };
}

export type Delivery = {
  ok: boolean;
  status: number | null;
  latency_ms: number;
  error: string | null;
  body: unknown;
};

/** POST JSON to a developer webhook with signature, re-validating the target, no redirects. */
export async function deliverWebhook(cfg: BpConfig, url: string, secret: string, eventType: string, payload: unknown): Promise<Delivery> {
  const start = Date.now();
  // DNS preflight is not coupled to fetch's resolver. Only an independently
  // enforced public-only egress boundary makes delivery safe on this runtime.
  if (!liveCapability(cfg).enabled) return { ok: false, status: null, latency_ms: 0, error: 'egress_not_enforced', body: null };
  const check = await assertPublicWebhook(url, webhookResolver(cfg), { allowInsecure: false });
  if (!check.ok) return { ok: false, status: null, latency_ms: Date.now() - start, error: `blocked_target:${check.reason}`, body: null };
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(secret, `${t}.${body}`);
  try {
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'BrowserPhone-Webhook/1.0', 'X-BrowserPhone-Event': eventType, 'X-BrowserPhone-Signature': `t=${t},v1=${sig}` };
    const pinned = pinnedOutbound();
    const r = pinned ? await pinned.fetch(check.url.toString(), { headers, body, timeoutMs: cfg.webhookTimeoutMs }) : await fetch(check.url.toString(), {
      method: "POST",
      redirect: "manual",
      headers: {
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(cfg.webhookTimeoutMs),
    });
    const latency = Date.now() - start;
    if (r.status >= 300 && r.status < 400) {
      return { ok: false, status: r.status, latency_ms: latency, error: "redirects_not_followed", body: null };
    }
    const text = await boundedText(r.body, 65536);
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text.slice(0, 2000);
    }
    return { ok: r.ok, status: r.status, latency_ms: latency, error: r.ok ? null : `http_${r.status}`, body: parsed };
  } catch (e) {
    const name = (e as Error)?.name;
    return { ok: false, status: null, latency_ms: Date.now() - start, error: e instanceof BodyLimitError ? 'response_too_large' : name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error", body: null };
  }
}
