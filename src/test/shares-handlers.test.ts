// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/bp/core";
const f = vi.hoisted(() => ({ store: null as any, enabled: true }));
vi.mock("@/server/shares/store", () => ({ createShareStore: async () => f.store }));
vi.mock("@/server/bp/core", async (original) => ({
  ...(await original<typeof import("@/server/bp/core")>()),
  liveCapability: () => ({ enabled: f.enabled }),
}));
import {
  createShare,
  getSharedPhone,
  createSharedSession,
  listShares,
  revokeShare,
} from "@/server/shares/handlers";
const id = "12345678-1234-4123-8123-123456789abc",
  share = "22345678-1234-4123-8123-123456789abc";
const token = "bp_share_" + "x".repeat(43),
  owner = "bp_conn_owner";
const req = (token: string, body?: unknown, key?: string) =>
  new Request("https://phone.test/api/public/v1", {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(async () => {
  f.enabled = true;
  f.store = {
    connection: vi.fn(async () => ({
      id,
      phone_token_hash: await sha256Hex(owner),
      verified_at: new Date().toISOString(),
      revoked_at: null,
      token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    })),
    share: vi.fn(async () => ({
      id: share,
      connection_id: id,
      token_hash: await sha256Hex(token),
      settings: { contact: { name: "Alice", number: "123" }, lang: "en" },
      call_limit: 3,
      calls_used: 3,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      revoked_at: null,
      created_at: new Date().toISOString(),
    })),
    create: vi.fn(async () => ({
      id: share,
      call_limit: 3,
      calls_used: 0,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      revoked_at: null,
      created_at: new Date().toISOString(),
      settings: { contact: { name: "Alice", number: "123" }, lang: "en" },
    })),
    list: vi.fn(async () => []),
    revoke: vi.fn(async () => true),
    session: vi.fn(async () => ({
      id,
      kind: "call",
      expires_at: new Date(Date.now() + 10000).toISOString(),
      call_deadline: null,
      replay: false,
    })),
  };
});
it("requires exact owner capability for creation/list/revoke and share capability for tester access", async () => {
  expect((await createShare(req(token, {}), id)).status).toBe(401);
  expect((await listShares(req(token), id)).status).toBe(401);
  expect((await revokeShare(req(token, {}), id, share)).status).toBe(401);
  expect((await getSharedPhone(req(owner), share)).status).toBe(401);
  expect(f.store.create).not.toHaveBeenCalled();
});
it("creates only hash token, validates limits/settings and returns token once", async () => {
  const body = {
    settings: { contact: { name: "Alice", number: "123" }, lang: "en" },
    call_limit: 3,
    expires_in_hours: 24,
  };
  const r = await createShare(req(owner, body), id);
  expect(r.status).toBe(201);
  const out = await r.json();
  expect(out.token).toMatch(/^bp_share_[\w-]{43}$/);
  expect(JSON.stringify(out.share)).not.toMatch(/token_hash|webhook|signing_secret|connection_id/);
  expect(f.store.create.mock.calls[0][0]).toMatchObject({
    connection_id: id,
    connection_hash: await sha256Hex(owner),
    token_hash: await sha256Hex(out.token),
  });
  for (const limit of [0, 101, 1.5])
    expect((await createShare(req(owner, { ...body, call_limit: limit }), id)).status).toBe(400);
  expect(
    (await createShare(req(owner, { ...body, settings: { ...body.settings, lang: "de" } }), id))
      .status,
  ).toBe(400);
  f.enabled = false;
  expect((await createShare(req(owner, body), id)).status).toBe(503);
});
it("returns exhausted usage without owner secrets and refuses expired/revoked connection or share", async () => {
  const r = await getSharedPhone(req(token), share);
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    settings: { contact: { name: "Alice" } },
    usage: { used: 3, limit: 3, remaining: 0, verified: true },
  });
  for (const field of ["revoked_at", "expires_at"]) {
    const original = await f.store.share();
    f.store.share.mockResolvedValue({
      ...original,
      [field]: new Date(Date.now() - 10000).toISOString(),
    });
    expect((await getSharedPhone(req(token), share)).status).toBe(410);
    f.store.share.mockResolvedValue(original);
  }
  f.store.connection.mockResolvedValue({
    ...(await f.store.connection()),
    token_expires_at: new Date(0).toISOString(),
  });
  expect((await getSharedPhone(req(token), share)).status).toBe(410);
});
it("requires idempotency, returns atomic tokens and stable errors", async () => {
  expect((await createSharedSession(req(token, { kind: "call" }), share)).status).toBe(400);
  const r = await createSharedSession(req(token, { kind: "call" }, "attempt"), share);
  expect(r.status).toBe(201);
  expect(await r.json()).toMatchObject({
    kind: "call",
    phone_token: expect.stringMatching(/^bp_phone_/),
    idempotent_replay: false,
  });
  expect(f.store.session.mock.calls[0][0]).toMatchObject({
    share_id: share,
    share_hash: await sha256Hex(token),
    kind: "call",
    idem: "attempt",
    callback_token: expect.stringMatching(/^bp_cb_/),
  });
  for (const [code, status] of [
    ["share_exhausted", 429],
    ["share_unavailable", 410],
    ["idempotency_conflict", 409],
    ["session_ended", 409],
    ["quota_exceeded", 429],
    ["too_many_concurrent", 429],
  ] as const) {
    f.store.session.mockResolvedValue({ error: code });
    expect((await createSharedSession(req(token, { kind: "call" }, "new"), share)).status).toBe(
      status,
    );
  }
});
it("bounds streaming JSON and denies unverified owners before writes", async () => {
  expect(
    (
      await createShare(
        new Request("https://phone.test", {
          method: "POST",
          headers: { Authorization: `Bearer ${owner}` },
          body: "x".repeat(16385),
        }),
        id,
      )
    ).status,
  ).toBe(413);
  f.store.connection.mockResolvedValue({ ...(await f.store.connection()), verified_at: null });
  expect((await createShare(req(owner, {}), id)).status).toBe(403);
  expect(f.store.create).not.toHaveBeenCalled();
});
