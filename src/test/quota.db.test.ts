// Database-backed tests for the atomic quota function. Runs only when backend
// service credentials are available (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const d = url && key ? describe : describe.skip;

d("bp_create_session quota (database)", () => {
  let db: SupabaseClient<Database>;
  beforeAll(() => {
    if (!url || !key) throw new Error("DB credentials required");
    db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  });
  const fp = `https://test.example.com/quota-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const create = async (conn: string, idem: string, limit = 20, maxConc = 1000) => {
    const { data, error } = await db.rpc("bp_create_session", { _connection_id: conn, _kind: "chat", _idem: idem, _phone_hash: "h", _callback_hash: "h", _daily_limit: limit, _max_concurrent: maxConc, _ttl_seconds: 600, _max_call_seconds: 600 });
    if (error) throw error;
    return data as { error?: string; reset_at?: string; replay?: boolean; id?: string; used?: number };
  };
  const newConn = async (verified = true) => {
    const { data, error } = await db.from("bp_connections").insert({ webhook_url: fp, fingerprint: fp, phone_token_hash: "x", signing_secret: "y", verified_at: verified ? new Date().toISOString() : null }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const usage = async () => (await db.from("bp_usage").select("count").eq("fingerprint", fp).eq("kind", "session").eq("day", today()).maybeSingle()).data?.count;
  const clearUsage = () => db.from("bp_usage").delete().eq("fingerprint", fp);

  afterAll(async () => {
    if (!db) return;
    await db.from("bp_connections").delete().eq("fingerprint", fp);
    await clearUsage();
  });

  it("refuses unverified connections", async () => {
    expect((await create(await newConn(false), "u1")).error).toBe("not_verified");
  });

  it("final slot is reserved atomically under concurrency and shared across re-registrations", async () => {
    const a = await newConn();
    const b = await newConn(); // re-registration of the same webhook
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => create(i % 2 ? a : b, `c-${i}`, 20)));
    expect(results.filter((r) => !r.error)).toHaveLength(20);
    const quota = results.filter((r) => r.error === "quota_exceeded");
    expect(quota).toHaveLength(10);
    expect(quota[0]?.reset_at).toBeTruthy();
    expect(await usage()).toBe(20);
  });

  it("idempotent retries do not consume quota", async () => {
    await clearUsage();
    const a = await newConn();
    const first = await create(a, "same-key", 5);
    const again = await Promise.all([create(a, "same-key", 5), create(a, "same-key", 5)]);
    expect(first.replay).toBe(false);
    expect(again.every((r) => r.replay === true && r.id === first.id)).toBe(true);
    expect(await usage()).toBe(1);
  });

  it("yesterday's usage does not count today (UTC daily reset)", async () => {
    await clearUsage();
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await db.from("bp_usage").insert({ fingerprint: fp, day: y, kind: "session", count: 999 });
    const r = await create(await newConn(), "next-day", 20);
    expect(r.error).toBeUndefined();
    expect(r.used).toBe(1);
  });

  it("bounds concurrent active sessions per webhook", async () => {
    await db.from("bp_sessions").update({ status: "ended" }).in("connection_id", (await db.from("bp_connections").select("id").eq("fingerprint", fp)).data?.map((x) => x.id) ?? []);
    const a = await newConn();
    const r = await Promise.all([create(a, "k1", 1000, 2), create(a, "k2", 1000, 2), create(a, "k3", 1000, 2)]);
    expect(r.filter((x) => x.error === "too_many_concurrent")).toHaveLength(1);
  });

  it("duplicate message/event ids are stored once per session and sessions don't share inboxes", async () => {
    await db.from("bp_sessions").update({ status: "ended" }).in("connection_id", (await db.from("bp_connections").select("id").eq("fingerprint", fp)).data?.map((x) => x.id) ?? []);
    const a = await newConn();
    const s1 = (await create(a, "iso-1", 1000)).id as string;
    const s2 = (await create(a, "iso-2", 1000)).id as string;
    const m = { _session_id: s1, _external_id: "m1", _direction: "app_to_phone", _type: "message", _text: "for s1", _link: null };
    const first = await db.rpc('bp_insert_message', m);
    const again = await db.rpc('bp_insert_message', m);
    expect(first.error).toBeNull();
    expect(again.data).toMatchObject({duplicate: true});
    expect((again.data as {seq:number}).seq).toBe((first.data as {seq:number}).seq);
    const e = { session_id: s1, event_id: "e1", type: "message.sent" };
    expect((await db.from("bp_events").insert(e)).error).toBeNull();
    expect((await db.from("bp_events").insert(e)).error?.code).toBe("23505");
    expect((await db.from("bp_messages").select("*").eq("session_id", s2)).data).toHaveLength(0);
  });
});
