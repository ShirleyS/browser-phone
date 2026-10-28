// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
let db:PGlite;
const owner='a'.repeat(64),hash='b'.repeat(64);
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.bp_connections(id uuid PRIMARY KEY,phone_token_hash text,verified_at timestamptz,revoked_at timestamptz,token_expires_at timestamptz);
    GRANT SELECT ON public.bp_connections TO service_role;`);
  await db.exec(readFileSync('drizzle/migrations/0005_optional_mojoauth_accounts.sql','utf8'));
},20000);
afterAll(async()=>{await db?.close();});
const save=(who:string,id=crypto.randomUUID(),connection:string|null=null,tokenHash:string|null=null)=>db.query<{result:string}>(`SELECT public.bp_save_account_setup($1::uuid,$2::text,$3::text,$4::text,$5::uuid,$6::text) AS result`,[id,who,'Saved setup','encrypted-test-payload',connection,tokenHash]);
it('creates service-only account tables with RLS and denies anonymous reads and RPC writes',async()=>{
  const {rows}=await db.query<{relname:string;relrowsecurity:boolean}>(`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('bp_account_states','bp_account_sessions','bp_account_setups') ORDER BY relname`);
  expect(rows).toHaveLength(3);expect(rows.every(r=>r.relrowsecurity)).toBe(true);
  await db.exec('SET ROLE anon');
  try {await expect(db.query('SELECT * FROM public.bp_account_setups')).rejects.toThrow('permission denied');await expect(save(owner)).rejects.toThrow('permission denied');}
  finally{await db.exec('RESET ROLE');}
});
it('allows exactly twenty saves for one owner even when requests arrive together',async()=>{
  await db.exec('SET ROLE service_role');
  try {
    const results=await Promise.all(Array.from({length:25},()=>save(owner)));
    expect(results.filter(r=>r.rows[0]!.result==='saved')).toHaveLength(20);
    expect(results.filter(r=>r.rows[0]!.result==='limit')).toHaveLength(5);
    expect((await save('c'.repeat(64))).rows[0]!.result).toBe('saved');
  }finally{await db.exec('RESET ROLE');}
});
it('requires the current verified, unrevoked, unexpired connection hash inside the save transaction',async()=>{
  const id=crypto.randomUUID(),who='d'.repeat(64);
  await db.query(`INSERT INTO public.bp_connections VALUES($1,$2,NULL,NULL,now()+interval '1 day')`,[id,hash]);
  expect((await save(who,undefined,id,hash)).rows[0]!.result).toBe('connection_invalid');
  await db.query(`UPDATE public.bp_connections SET verified_at=now() WHERE id=$1`,[id]);
  expect((await save(who,undefined,id,'e'.repeat(64))).rows[0]!.result).toBe('connection_invalid');
  expect((await save(who,undefined,id,hash)).rows[0]!.result).toBe('saved');
  await db.query(`UPDATE public.bp_connections SET revoked_at=now() WHERE id=$1`,[id]);
  expect((await save(who,undefined,id,hash)).rows[0]!.result).toBe('connection_invalid');
  await db.query(`UPDATE public.bp_connections SET revoked_at=NULL,token_expires_at=now()-interval '1 second' WHERE id=$1`,[id]);
  expect((await save(who,undefined,id,hash)).rows[0]!.result).toBe('connection_invalid');
});
