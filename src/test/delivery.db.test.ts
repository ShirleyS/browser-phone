// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { sha256Hex } from '@/server/bp/core';
import crypto from 'node:crypto';
const url=process.env['SUPABASE_URL']; const key=process.env['SUPABASE_SERVICE_ROLE_KEY'];
const state=vi.hoisted(()=>({db:null as SupabaseClient<Database>|null}));
vi.mock('@/integrations/supabase/client.server',()=>({get supabaseAdmin(){ if(!state.db) throw new Error('DB unavailable'); return state.db; }}));
const delivery=vi.hoisted(()=>vi.fn());
vi.mock('@/server/bp/core',async importOriginal=>({...await importOriginal<typeof import('@/server/bp/core')>(), deliverWebhook: delivery}));
import { postEvent, listMessages } from '@/server/bp/handlers';
import { PhoneEngine, type Deps } from '@/lib/phone/engine';
(url&&key?describe:describe.skip)('live delivery, pairing and inbox atomicity',()=>{
  let db:SupabaseClient<Database>; let conn:string; let session:string;
  const fp=`https://test.example.com/release-${crypto.randomUUID()}`;
  const phoneToken='bp_phone_regression';
  beforeAll(async()=>{
    if(!url||!key) throw new Error('Missing DB vars');
    db=createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});state.db=db;
    const c=await db.from('bp_connections').insert({webhook_url:fp,fingerprint:fp,phone_token_hash:'hash',signing_secret:'test_secret',verified_at:new Date().toISOString()}).select('id').single();
    if(c.error||!c.data) throw c.error||new Error('Fixture failed'); conn=c.data.id;
    const s=await db.rpc('bp_create_session',{_connection_id:conn,_kind:'chat',_idem:'release-test',_phone_hash:await sha256Hex(phoneToken),_callback_hash:'hash',_daily_limit:20,_max_concurrent:3,_ttl_seconds:600,_max_call_seconds:600});
    if(s.error) throw s.error;session=(s.data as {id:string}).id;
    await db.from('bp_sessions').update({callback_token:'bp_cb_regression'}).eq('id',session);
  });
  afterAll(async()=>{if(!db)return;await db.from('bp_connections').delete().eq('fingerprint',fp);await db.from('bp_usage').delete().eq('fingerprint',fp);state.db=null;});
  const request=(id:string,type='message.sent',text='test')=>new Request(`https://phone.test/api/public/v1/sessions/${session}/events`,{method:'POST',headers:{Authorization:`Bearer ${phoneToken}`,'Content-Type':'application/json'},body:JSON.stringify({id,type,text})});
  it('UTF8 max-length backlog reaches the engine over multiple byte-bounded polls without gaps',async()=>{
    const s=await db.rpc('bp_create_session',{_connection_id:conn,_kind:'chat',_idem:'backlog',_phone_hash:await sha256Hex(phoneToken),_callback_hash:'hash',_daily_limit:20,_max_concurrent:3,_ttl_seconds:600,_max_call_seconds:600});
    if(s.error)throw s.error;const sid=(s.data as {id:string}).id;
    const ids=Array.from({length:55},(_,i)=>`backlog-${i}`); const text='漢'.repeat(4000);
    for(const id of ids){const r=await db.rpc('bp_insert_message',{_session_id:sid,_external_id:id,_direction:'app_to_phone',_type:'message',_text:text,_link:{label:'漢'.repeat(80),url:'https://example.com/'+ 'x'.repeat(2000)}});if(r.error)throw r.error;}
    const sizes:number[]=[]; let lastCursor='0';
    const deps:Deps={now:()=>Date.now(),uuid:()=>crypto.randomUUID(),setTimeout,clearTimeout,getUserMedia:async()=>{throw new Error('No mic');},startVoice:async()=>{throw new Error('No voice');},fetch:async(input,init)=>{
      const u=new URL(String(input));
      if(u.pathname.endsWith('/sessions'))return Response.json({id:sid,phone_token:phoneToken,expires_at:new Date(Date.now()+600000).toISOString()});
      if(u.pathname.endsWith('/messages')){const r=await listMessages(new Request(u,{headers:{Authorization:`Bearer ${phoneToken}`}}),sid);const raw=await r.text();sizes.push(Buffer.byteLength(raw));const body=JSON.parse(raw);if(body.messages.length){expect(BigInt(body.next_cursor)).toBeGreaterThan(BigInt(lastCursor));lastCursor=body.next_cursor;}return new Response(raw,{status:r.status});}
      return Response.json({delivery:{ok:true}});
    }};
    const engine=new PhoneEngine(deps,{mode:'live',connection:{apiBase:'https://phone.test/api/public/v1',connectionId:conn,phoneToken:'unused',webhookUrl:fp,verified:true}});
    try{await engine.sendMessage('open inbox');for(let i=0;i<30&&engine.state.chat.filter(m=>m.id.startsWith(`app-${sid}-`)).length<55;i++)await engine.pollOnce();
      const received=engine.state.chat.filter(m=>m.id.startsWith(`app-${sid}-`));expect(received.map(m=>m.id.replace(`app-${sid}-`,''))).toEqual(ids);expect(received.every(m=>m.text===text)).toBe(true);expect(sizes.length).toBeGreaterThan(1);expect(sizes.every(n=>n<=60000)).toBe(true);
    }finally{await engine.dispose();}
  },60000);
  it('transient webhook 503 then success redelivers SAME event ID; success is cached',async()=>{
    delivery.mockReset().mockResolvedValueOnce({ok:false,status:503,latency_ms:1,error:'http_503',body:null}).mockResolvedValueOnce({ok:true,status:200,latency_ms:1,error:null,body:{reply:{text:'recovered'}}});
    expect((await postEvent(request('retry-503'),session)).status).toBe(502);
    const success=await postEvent(request('retry-503'),session); expect(success.status).toBe(200);
    const first=await success.json(); const replay=await postEvent(request('retry-503'),session);expect(await replay.json()).toEqual(first);
    expect(delivery).toHaveBeenCalledTimes(2);
  });
  it('concurrent duplicate requests deliver once',async()=>{
    delivery.mockReset(); let resolve:((v:unknown)=>void)|undefined;
    delivery.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const first=postEvent(request('concurrent'),session);
    for(let i=0;i<100&&!resolve;i++)await new Promise(r=>setTimeout(r,20));
    expect(resolve).toBeDefined();
    const duplicate=await postEvent(request('concurrent'),session); expect(duplicate.status).toBe(409);
    resolve?.({ok:true,status:200,latency_ms:1,error:null,body:{}});expect((await first).status).toBe(200);expect(delivery).toHaveBeenCalledOnce();
  });
  it('successful call.start replays full voice configuration',async()=>{
    await db.from('bp_sessions').update({kind:'call',call_deadline:new Date(Date.now()+60000).toISOString()}).eq('id',session);
    const voice={provider:'elevenlabs',transport:'websocket',signed_url:'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_test&token=abcdefgh'};
    delivery.mockReset().mockResolvedValue({ok:true,status:200,latency_ms:1,error:null,body:{voice}});
    const a=await postEvent(request('voice-replay','call.start'),session);const b=await postEvent(request('voice-replay','call.start'),session);
    expect((await a.json()).voice).toEqual(voice);expect((await b.json()).voice).toEqual(voice);expect(delivery).toHaveBeenCalledOnce();
  });
  it('server rejects attacker voice config',async()=>{
    delivery.mockReset().mockResolvedValue({ok:true,status:200,latency_ms:1,error:null,body:{voice:{provider:'elevenlabs',transport:'websocket',signed_url:'wss://attacker.test/audio'}}});
    const r=await postEvent(request('unsafe-voice','call.start'),session);expect(await r.json()).toMatchObject({voice:null,contract_error:'invalid_voice_config'});
  });
  it('expired pending lease is reclaimable; stale finisher cannot overwrite new lease',async()=>{
    const a=crypto.randomUUID(), b=crypto.randomUUID(); const args={_session_id:session,_event_id:'lease',_type:'message.sent',_request:{text:'test'}};
    expect((await db.rpc('bp_claim_event',{...args,_lease:a})).data).toMatchObject({claimed:true});
    expect((await db.rpc('bp_claim_event',{...args,_lease:b})).data).toMatchObject({pending:true});
    await db.from('bp_events').update({lease_until:new Date(Date.now()-1000).toISOString()}).eq('session_id',session).eq('event_id','lease');
    expect((await db.rpc('bp_claim_event',{...args,_lease:b})).data).toMatchObject({claimed:true});
    expect((await db.rpc('bp_finish_event',{_session_id:session,_event_id:'lease',_lease:a,_ok:true,_response:{},_status:200})).data).toBe(false);
    expect((await db.rpc('bp_finish_event',{_session_id:session,_event_id:'lease',_lease:b,_ok:true,_response:{voice:'cached'},_status:200})).data).toBe(true);
  });
  it('parallel pairing permits exactly five failed attempts',async()=>{
    await db.from('bp_connections').update({verified_at:null,pairing_attempts:0,pairing_code_hash:'correct',pairing_expires_at:new Date(Date.now()+60000).toISOString()}).eq('id',conn);
    const results=await Promise.all(Array.from({length:20},()=>db.rpc('bp_verify_pairing',{_connection_id:conn,_candidate_hash:'wrong'})));
    expect(results.filter(r=>(r.data as {error:string}).error==='invalid_code')).toHaveLength(5);
    expect(results.filter(r=>(r.data as {error:string}).error==='too_many_attempts')).toHaveLength(15);
    expect((await db.from('bp_connections').select('pairing_attempts').eq('id',conn).single()).data?.pairing_attempts).toBe(5);
    expect((await db.rpc('bp_verify_pairing',{_connection_id:conn,_candidate_hash:'correct'})).data).toMatchObject({error:'too_many_attempts'});
  });
  it('inbox concurrent inserts cannot allocate before session lock and commit in cursor order',async()=>{
    const args={_session_id:session,_direction:'app_to_phone',_type:'message',_text:'ordered',_link:null};
    const [a,b]=await Promise.all([db.rpc('bp_insert_message',{...args,_external_id:'ordered-a'}),db.rpc('bp_insert_message',{...args,_external_id:'ordered-b'})]);
    expect(a.error).toBeNull();expect(b.error).toBeNull();
    const seqA=(a.data as {seq:number}).seq,seqB=(b.data as {seq:number}).seq;expect(seqA).not.toBe(seqB);
    const polled=await db.from('bp_messages').select('seq').eq('session_id',session).gt('seq',Math.min(seqA,seqB)).order('seq');expect(polled.data?.some(m=>m.seq===Math.max(seqA,seqB))).toBe(true);
  });
});
