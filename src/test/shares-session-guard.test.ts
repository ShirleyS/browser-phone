// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { sha256Hex } from "@/server/bp/core";
const f = vi.hoisted(() => ({
  row: null as any,
  share: null as any,
  claim: vi.fn(),
  delivery: vi.fn(),
  messages: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock("@/server/bp/core", async (original) => ({
  ...(await original<typeof import("@/server/bp/core")>()),
  admin: async () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: f.row }) }) }),
    }),
    rpc: async (name: string, args: any) => {
      if (name === "bp_claim_event") {
        f.claim(args);
        const value = f.cache.get(args._event_id);
        return { data: value ? { cached: true, response: value, status: 200 } : { claimed: true } };
      }
      if (name === "bp_finish_event") {
        f.cache.set(args._event_id, args._response);
        return { data: true };
      }
      f.messages(name);
      return { data: { seq: 1 } };
    },
  }),
  deliverWebhook: f.delivery,
}));
vi.mock("@/server/shares/store", () => ({
  createShareStore: async () => ({ share: async () => f.share }),
}));
import { postEvent, listMessages, postAppMessage } from "@/server/bp/handlers";
const id = "12345678-1234-4123-8123-123456789abc",
  share = "22345678-1234-4123-8123-123456789abc",
  phone = "bp_phone_test",
  callback = "bp_cb_test";
const req = (token = phone, body?: unknown) =>
  new Request("https://phone.test", {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(async () => {
  f.claim.mockClear();
  f.delivery
    .mockReset()
    .mockResolvedValue({ ok: true, status: 200, latency_ms: 1, error: null, body: {} });
  f.messages.mockClear();
  f.cache.clear();
  f.row = {
    id,
    share_id: share,
    connection_id: "owner",
    kind: "call",
    status: "active",
    phone_token_hash: await sha256Hex(phone),
    callback_token_hash: await sha256Hex(callback),
    callback_token: callback,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    call_deadline: new Date(Date.now() + 60000).toISOString(),
    bp_connections: {
      webhook_url: "https://example.com",
      signing_secret: "secret",
      revoked_at: null,
      token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    },
  };
  f.share = {
    connection_id: "owner",
    revoked_at: null,
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
});
it("canonicalizes shared call starts so arbitrary IDs and text replay one committed delivery", async () => {
  const a = await postEvent(req(phone, { id: "one", type: "call.start", text: "first" }), id);
  const b = await postEvent(req(phone, { id: "two", type: "call.start", text: "changed" }), id);
  expect(a.status).toBe(200);
  expect(await b.json()).toEqual(await a.json());
  expect(f.delivery).toHaveBeenCalledOnce();
  const [x, y] = f.claim.mock.calls.map((c) => c[0]);
  expect(x._event_id).toBe(y._event_id);
  expect(x._request).toEqual(y._request);
  expect(x._request).not.toHaveProperty("text");
});
it("rejects call.start on shared chat sessions before event claim or webhook", async () => {
  f.row.kind = "chat";
  expect((await postEvent(req(phone, { id: "start", type: "call.start" }), id)).status).toBe(409);
  expect(f.claim).not.toHaveBeenCalled();
  expect(f.delivery).not.toHaveBeenCalled();
});
it.each(["revoked", "expired", "missing", "connection-expired"])(
  "denies %s share session events, phone inbox, and callback inserts",
  async (reason) => {
    if (reason === "revoked") f.share.revoked_at = new Date().toISOString();
    if (reason === "expired") f.share.expires_at = new Date(0).toISOString();
    if (reason === "missing") f.share = null;
    if (reason === "connection-expired")
      f.row.bp_connections.token_expires_at = new Date(0).toISOString();
    expect((await postEvent(req(phone, { id: "x", type: "call.start" }), id)).status).toBe(410);
    expect((await listMessages(req(), id)).status).toBe(410);
    expect((await postAppMessage(req(callback, { id: "reply", text: "late" }), id)).status).toBe(
      410,
    );
    expect(f.delivery).not.toHaveBeenCalled();
    expect(f.messages).not.toHaveBeenCalled();
  },
);
it("keeps owner call-start IDs distinct", async () => {
  f.row.share_id = null;
  await postEvent(req(phone, { id: "owner-one", type: "call.start" }), id);
  await postEvent(req(phone, { id: "owner-two", type: "call.start" }), id);
  expect(f.delivery).toHaveBeenCalledTimes(2);
});
