import { z } from "zod";
import {
  apiBase,
  apiError,
  bearer,
  getConfig,
  json,
  liveCapability,
  randomToken,
  readJson,
  safeEqual,
  sha256Hex,
} from "@/server/bp/core";
import { createShareStore, type ShareSummary } from "./store";
const uuid = z.string().uuid();
const extId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const settings = z
  .object({
    contact: z
      .object({ name: z.string().trim().min(1).max(80), number: z.string().trim().min(1).max(80) })
      .strict(),
    lang: z.enum(["en", "es"]),
  })
  .strict();
function summary(s: ShareSummary) {
  return {
    id: s.id,
    call_limit: s.call_limit,
    calls_used: s.calls_used,
    expires_at: s.expires_at,
    revoked_at: s.revoked_at,
    created_at: s.created_at,
  };
}
const unavailable = () =>
  apiError(410, "share_unavailable", "This test phone is expired or revoked");
async function owner(request: Request, id: string) {
  if (!uuid.safeParse(id).success)
    return { res: apiError(404, "not_found", "Connection not found") } as const;
  const token = bearer(request);
  if (!token) return { res: apiError(401, "unauthorized", "Missing connection token") } as const;
  const store = await createShareStore(),
    c = await store.connection(id),
    hash = await sha256Hex(token);
  if (!c || !safeEqual(c.phone_token_hash, hash))
    return { res: apiError(401, "unauthorized", "Invalid connection token") } as const;
  if (c.revoked_at || new Date(c.token_expires_at).getTime() <= Date.now())
    return { res: apiError(401, "token_expired", "Connection expired or revoked") } as const;
  if (!c.verified_at)
    return { res: apiError(403, "not_verified", "Verify webhook ownership first") } as const;
  return { store, hash } as const;
}
async function tester(request: Request, id: string) {
  if (!uuid.safeParse(id).success)
    return { res: apiError(404, "not_found", "Test phone not found") } as const;
  const token = bearer(request);
  if (!token || !/^bp_share_[A-Za-z0-9_-]{43}$/.test(token))
    return { res: apiError(401, "unauthorized", "Invalid share token") } as const;
  const store = await createShareStore(),
    s = await store.share(id),
    hash = await sha256Hex(token);
  if (!s || !safeEqual(s.token_hash, hash))
    return { res: apiError(401, "unauthorized", "Invalid share token") } as const;
  if (s.revoked_at || new Date(s.expires_at).getTime() <= Date.now())
    return { res: unavailable() } as const;
  const c = await store.connection(s.connection_id);
  if (!c || !c.verified_at || c.revoked_at || new Date(c.token_expires_at).getTime() <= Date.now())
    return { res: unavailable() } as const;
  return { store, share: s, hash } as const;
}
function protectedHandler<A extends unknown[]>(
  fn: (request: Request, ...args: A) => Promise<Response>,
) {
  return async (request: Request, ...args: A) => {
    try {
      return await fn(request, ...args);
    } catch {
      return apiError(500, "internal_error", "Test phone service unavailable");
    }
  };
}
export const createShare = protectedHandler(async (request: Request, id: string) => {
  const l = await owner(request, id);
  if ("res" in l) return l.res;
  if (!liveCapability().enabled)
    return apiError(
      503,
      "egress_not_enforced",
      "Live test phones require enforced public-only egress",
    );
  const body = await readJson(request, getConfig().maxBodyBytes);
  if (!body.ok) return body.res;
  const p = z
    .object({
      settings,
      call_limit: z.number().int().min(1).max(100),
      expires_in_hours: z.union([z.literal(1), z.literal(24), z.literal(168)]),
    })
    .strict()
    .safeParse(body.data);
  if (!p.success)
    return apiError(
      400,
      "invalid_request",
      "Provide contact, language, 1–100 calls and expiry of 1, 24 or 168 hours",
    );
  const token = randomToken("bp_share_");
  const s = await l.store.create({
    id: crypto.randomUUID(),
    connection_id: id,
    connection_hash: l.hash,
    token_hash: await sha256Hex(token),
    settings: p.data.settings,
    call_limit: p.data.call_limit,
    hours: p.data.expires_in_hours,
  });
  if (s.error === "share_limit")
    return apiError(429, "share_limit", "At most 20 active test links per connection");
  if (s.error) return apiError(403, s.error, "Could not create test phone");
  return json({ share: summary(s), token }, 201);
});
export const listShares = protectedHandler(async (request: Request, id: string) => {
  const l = await owner(request, id);
  if ("res" in l) return l.res;
  return json({ shares: (await l.store.list(id)).map(summary) });
});
export const revokeShare = protectedHandler(
  async (request: Request, id: string, shareId: string) => {
    const l = await owner(request, id);
    if ("res" in l) return l.res;
    if (!uuid.safeParse(shareId).success || !(await l.store.revoke(id, shareId, l.hash)))
      return apiError(404, "not_found", "Test phone not found");
    return json({ revoked: true });
  },
);
export const getSharedPhone = protectedHandler(async (request: Request, id: string) => {
  const l = await tester(request, id);
  if ("res" in l) return l.res;
  const s = l.share;
  return json({
    settings: s.settings,
    expires_at: s.expires_at,
    usage: {
      used: s.calls_used,
      limit: s.call_limit,
      remaining: Math.max(0, s.call_limit - s.calls_used),
      reset_at: s.expires_at,
      verified: true,
    },
  });
});
export const createSharedSession = protectedHandler(async (request: Request, id: string) => {
  const l = await tester(request, id);
  if ("res" in l) return l.res;
  const cfg = getConfig();
  if (!liveCapability(cfg).enabled)
    return apiError(
      503,
      "egress_not_enforced",
      "Live test phones require enforced public-only egress",
    );
  const body = await readJson(request, cfg.maxBodyBytes);
  if (!body.ok) return body.res;
  const p = z
    .object({ kind: z.enum(["chat", "call"]) })
    .strict()
    .safeParse(body.data);
  if (!p.success) return apiError(400, "invalid_request", "kind must be chat or call");
  const idem = request.headers.get("Idempotency-Key");
  if (!extId.safeParse(idem).success)
    return apiError(
      400,
      "idempotency_key_required",
      "Provide an Idempotency-Key header (1–128 safe characters)",
    );
  const phoneToken = randomToken("bp_phone_"),
    callbackToken = randomToken("bp_cb_");
  const r = await l.store.session({
    share_id: id,
    share_hash: l.hash,
    kind: p.data.kind,
    idem: idem!,
    phone_hash: await sha256Hex(phoneToken),
    callback_hash: await sha256Hex(callbackToken),
    callback_token: callbackToken,
    daily_limit: cfg.dailySessionLimit,
    max_concurrent: cfg.maxConcurrentSessions,
    ttl_seconds: cfg.sessionTtlSeconds,
    max_call_seconds: cfg.maxCallSeconds,
  });
  if (r.error) {
    const status =
      r.error === "share_unavailable"
        ? 410
        : ["share_exhausted", "quota_exceeded", "too_many_concurrent"].includes(r.error)
          ? 429
          : ["idempotency_conflict", "session_ended"].includes(r.error)
            ? 409
            : 400;
    const resetAt =
      r.error === "share_exhausted"
        ? new Date(l.share.expires_at)
        : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    if (r.error !== "share_exhausted") resetAt.setUTCDate(resetAt.getUTCDate() + 1);
    const retryAfter =
      r.error === "too_many_concurrent"
        ? "30"
        : String(Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)));
    return apiError(
      status,
      r.error,
      r.error === "share_exhausted"
        ? "No calls remain on this test phone"
        : "Could not start this session",
      status === 429 && r.error !== "too_many_concurrent"
        ? { reset_at: resetAt.toISOString() }
        : {},
      status === 429 ? { "Retry-After": retryAfter } : {},
    );
  }
  const base = apiBase(request, cfg);
  return json(
    {
      id: r.id,
      kind: r.kind,
      phone_token: phoneToken,
      expires_at: r.expires_at,
      call_deadline: r.call_deadline,
      idempotent_replay: !!r.replay,
      usage: r.replay ? null : { used: r.used, limit: r.limit },
      endpoints: {
        events: `${base}/sessions/${r.id}/events`,
        messages: `${base}/sessions/${r.id}/messages`,
      },
    },
    r.replay ? 200 : 201,
  );
});
