// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
interface SessionRpcResult {
  error?: string;
  id: string;
  kind: "chat" | "call";
  expires_at: string;
  call_deadline: string | null;
  replay: boolean;
}
interface SessionRow {
  callback_token: string | null;
  callback_token_hash: string;
  phone_token_hash: string;
  share_id: string | null;
}
// Scalar SELECTs always return one row. Other single-row reads below use an ID
// inserted successfully by the same test, so the non-null assertions encode
// that fixture invariant without weakening the project's strict settings.
let db: PGlite;
const hash = "a".repeat(64),
  shareHash = "b".repeat(64);
beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  for (const name of [
    "0000_browser_phone_core",
    "0001_bp_callback_token",
    "0002_bp_token_expiry_revocation",
    "0003_bp_fix_create_session",
    "0004_release_atomic_delivery_inbox_pairing",
    "0006_shared_test_phones",
  ])
    await db.exec(readFileSync(`drizzle/migrations/${name}.sql`, "utf8"));
}, 20000);
afterAll(async () => {
  await db?.close();
});
async function fixture(limit = 1, fp = crypto.randomUUID()) {
  const c = crypto.randomUUID(),
    s = crypto.randomUUID();
  await db.query(
    `INSERT INTO bp_connections(id,webhook_url,fingerprint,phone_token_hash,signing_secret,verified_at) VALUES($1,'https://example.com',$2,$3,'secret',now())`,
    [c, fp, hash],
  );
  const r = await db.query<{ r: { error?: string } }>(
    `SELECT bp_create_share($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,24) r`,
    [
      s,
      c,
      hash,
      shareHash,
      JSON.stringify({ contact: { name: "Test", number: "123" }, lang: "en" }),
      limit,
    ],
  );
  expect(r.rows[0]!.r.error).toBeUndefined();
  return { c, s };
}
async function session(s: string, key: string, kind = "call", daily = 20, max = 100) {
  return (
    await db.query<{ r: SessionRpcResult }>(
      `SELECT bp_create_shared_session($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,1800,900) r`,
      [s, shareHash, kind, key, "phone-" + key, "callback-hash", "callback-" + key, daily, max],
    )
  ).rows[0]!.r;
}
it("enforces one shared total across simultaneous testers, with atomic tokens and replay after exhaustion", async () => {
  const { s } = await fixture();
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => session(s, "call-" + i)));
  expect(rs.filter((r) => !r.error)).toHaveLength(1);
  expect(rs.filter((r) => r.error === "share_exhausted")).toHaveLength(11);
  const first = rs.find((r) => !r.error)!;
  const again = await session(s, "call-0");
  expect(again).toMatchObject({ id: first.id, replay: true });
  const row = (await db.query<SessionRow>("SELECT * FROM bp_sessions WHERE id=$1", [first.id]))
    .rows[0]!;
  expect(row.callback_token).toBe("callback-call-0");
  expect(row.phone_token_hash).toBe("phone-call-0");
  expect(row.share_id).toBe(s);
  expect((await session(s, "chat", "chat")).error).toBeUndefined();
  expect((await session(s, "call-0", "chat")).error).toBe("idempotency_conflict");
  await db.query(`UPDATE bp_sessions SET status='ended' WHERE id=$1`, [first.id]);
  expect((await session(s, "call-0")).error).toBe("session_ended");
});
it("preserves daily and concurrent quotas without charging failed reservations", async () => {
  const { s } = await fixture(5);
  expect((await session(s, "a", "call", 1, 1)).error).toBeUndefined();
  expect((await session(s, "b", "call", 1, 1)).error).toBe("too_many_concurrent");
  await db.query(`UPDATE bp_sessions SET status='ended' WHERE share_id=$1`, [s]);
  expect((await session(s, "c", "call", 1, 1)).error).toBe("quota_exceeded");
  expect(
    (await db.query<{ calls_used: number }>("SELECT calls_used FROM bp_shares WHERE id=$1", [s]))
      .rows[0]!.calls_used,
  ).toBe(1);
});
it("caps lifetime and rejects revoked/expired share, expired connection and wrong token", async () => {
  const { c, s } = await fixture(3);
  await db.query(`UPDATE bp_shares SET expires_at=now()+interval '10 seconds' WHERE id=$1`, [s]);
  const r = await session(s, "cap");
  const expiry = (
    await db.query<{ expires_at: Date }>("SELECT expires_at FROM bp_shares WHERE id=$1", [s])
  ).rows[0]!.expires_at;
  expect(new Date(r.expires_at).getTime()).toBe(new Date(expiry).getTime());
  expect(r.call_deadline).toBe(r.expires_at);
  await db.query("UPDATE bp_shares SET revoked_at=now() WHERE id=$1", [s]);
  expect((await session(s, "cap")).error).toBe("share_unavailable");
  await db.query(
    `UPDATE bp_shares SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE id=$1`,
    [s],
  );
  expect((await session(s, "expired")).error).toBe("share_unavailable");
  await db.query(`UPDATE bp_shares SET expires_at=now()+interval '1 hour' WHERE id=$1`, [s]);
  await db.query(
    `UPDATE bp_connections SET token_expires_at=now()-interval '1 second' WHERE id=$1`,
    [c],
  );
  expect((await session(s, "connection-expired")).error).toBe("share_unavailable");
});
it("bounds active links at twenty atomically, checks exact owner and denies public roles", async () => {
  const { c } = await fixture();
  const make = (token = hash) =>
    db.query<{ r: { error?: string } }>(
      `SELECT bp_create_share($1::uuid,$2::uuid,$3,$4,'{"contact":{"name":"Test","number":"1"},"lang":"en"}'::jsonb,3,24) r`,
      [crypto.randomUUID(), c, token, shareHash],
    );
  expect((await make("c".repeat(64))).rows[0]!.r.error).toBe("connection_invalid");
  const rs = await Promise.all(Array.from({ length: 24 }, () => make()));
  expect(rs.filter((r) => !r.rows[0]!.r.error)).toHaveLength(19);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    try {
      await expect(db.query("SELECT * FROM bp_shares")).rejects.toThrow("permission denied");
      await expect(make()).rejects.toThrow("permission denied");
    } finally {
      await db.exec("RESET ROLE");
    }
  }
});
it("rotates only phone token on retry and isolates identically named attempts and inboxes between shares", async () => {
  const { c, s } = await fixture(3);
  const other = crypto.randomUUID();
  await db.query(
    `SELECT bp_create_share($1::uuid,$2::uuid,$3,$4,'{"contact":{"name":"Other","number":"2"},"lang":"es"}'::jsonb,3,24)`,
    [other, c, hash, shareHash],
  );
  const first = await session(s, "same"),
    second = await session(other, "same");
  expect(first.id).not.toBe(second.id);
  const retry = (
    await db.query<{ r: SessionRpcResult }>(
      `SELECT bp_create_shared_session($1::uuid,$2,'call','same','rotated-phone','new-cb-hash','new-callback',20,100,1800,900) r`,
      [s, shareHash],
    )
  ).rows[0]!.r;
  expect(retry).toMatchObject({ id: first.id, replay: true });
  const row = (await db.query<SessionRow>("SELECT * FROM bp_sessions WHERE id=$1", [first.id]))
    .rows[0]!;
  expect(row.phone_token_hash).toBe("rotated-phone");
  expect(row.callback_token).toBe("callback-same");
  expect(row.callback_token_hash).toBe("callback-hash");
  expect(
    (
      await db.query<{ calls_used: number }>(
        "SELECT calls_used FROM bp_shares WHERE connection_id=$1 ORDER BY id",
        [c],
      )
    ).rows.map((r) => r.calls_used),
  ).toEqual([1, 1]);
  await db.query(
    `SELECT bp_insert_message($1::uuid,'private','app_to_phone','message','private text',NULL)`,
    [first.id],
  );
  expect(
    (await db.query("SELECT * FROM bp_messages WHERE session_id=$1", [second.id])).rows,
  ).toHaveLength(0);
  await db.query(`UPDATE bp_sessions SET expires_at=now()-interval '1 second' WHERE id=$1`, [
    first.id,
  ]);
  expect((await session(s, "same")).error).toBe("session_ended");
});
it("service role can reserve but unsupported language and invalid share credentials fail closed", async () => {
  const { c, s } = await fixture(3);
  const invalid = (
    await db.query<{ r: { error: string } }>(
      `SELECT bp_create_share($1::uuid,$2::uuid,$3,$4,'{"contact":{"name":"Test","number":"1"},"lang":"de"}'::jsonb,3,24) r`,
      [crypto.randomUUID(), c, hash, shareHash],
    )
  ).rows[0]!.r;
  expect(invalid.error).toBe("invalid_request");
  expect(
    (
      await db.query<{ r: { error: string } }>(
        `SELECT bp_create_shared_session($1::uuid,NULL,'call','bad','p','c','cb',20,3,1800,900) r`,
        [s],
      )
    ).rows[0]!.r.error,
  ).toBe("share_unavailable");
  await db.exec("SET ROLE service_role");
  try {
    expect((await session(s, "service")).error).toBeUndefined();
  } finally {
    await db.exec("RESET ROLE");
  }
});
it("revoking a link atomically ends only its sessions and frees fingerprint concurrency", async () => {
  const { c, s } = await fixture(3);
  const active = await session(s, "active", "call", 20, 1);
  expect((await session(s, "blocked", "call", 20, 1)).error).toBe("too_many_concurrent");
  const revoke = (token = hash) =>
    db.query<{ result: boolean }>(`SELECT bp_revoke_share($1::uuid,$2::uuid,$3) result`, [
      c,
      s,
      token,
    ]);
  expect((await revoke("wrong")).rows[0]!.result).toBe(false);
  expect((await revoke()).rows[0]!.result).toBe(true);
  expect((await session(s, "active")).error).toBe("share_unavailable");
  const row = (
    await db.query<{ status: string }>("SELECT status FROM bp_sessions WHERE id=$1", [active.id])
  ).rows[0]!;
  expect(row.status).toBe("ended");
  const other = crypto.randomUUID();
  await db.query(
    `SELECT bp_create_share($1::uuid,$2::uuid,$3,$4,'{"contact":{"name":"Next","number":"2"},"lang":"en"}'::jsonb,3,24)`,
    [other, c, hash, shareHash],
  );
  expect((await session(other, "next", "call", 20, 1)).error).toBeUndefined();
});
