// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { makeAccountHandlers } from '@/server/account/handlers';
import { MemoryAccountStore } from './helpers/account-store';
import { sha256Hex } from '@/server/bp/core';
import type { AccountConfig } from '@/server/account/config';
import type { LoginFlow } from '@/server/account/oidc';
const origin='https://phone.example.com',base=origin+'/api/public/v1/account';
const config:AccountConfig={issuer:'https://identity.example.mojoauth.com',clientId:'test-client',clientSecret:'test-secret',origin,key:'ab'.repeat(32),secure:true};
const settings={contact:{name:'My café',number:'+52 55 91100000'},lang:'en' as const,agentId:''};
function cookie(response:Response) {return response.headers.get('set-cookie')!.split(';')[0]!;}
function req(path:string,session='',body?:unknown,requestOrigin=origin) { return new Request(base+path,{method:'POST',headers:{Origin:requestOrigin,Cookie:session,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})}); }
function harness() {
  const store=new MemoryAccountStore();let flow:LoginFlow;let subject='a';let now=Date.now();
  const provider={authorize:vi.fn(async(f:LoginFlow)=>{flow=f;return 'https://identity.example.mojoauth.com/authorize';}),authenticate:vi.fn(async()=>({issuer:config.issuer,subject}))};
  const handlers=makeAccountHandlers({config:()=>config,store:()=>Promise.resolve(store),provider:()=>provider,now:()=>now});
  const login=async(person='a')=>{subject=person;const start=await handlers.beginLogin(req('/login'));const fc=cookie(start);const callback=new Request(base+'/callback?code=test&state='+flow!.state,{headers:{Cookie:fc}});const response=await handlers.finishLogin(callback);return {session:cookie(response),response,callback,flow:flow!};};
  return {store,provider,handlers,login,setNow:(v:number)=>{now=v;}};
}
describe('optional account access',()=>{
  it('requires no provider or database when disabled',async()=>{
    const store=vi.fn();const h=makeAccountHandlers({config:()=>null,store,provider:vi.fn()});
    expect(await (await h.accountStatus(new Request(base))).json()).toEqual({enabled:false,signed_in:false,reason:'not_configured'});
    expect((await h.beginLogin(req('/login'))).status).toBe(503);expect(store).not.toHaveBeenCalled();
  });
  it('binds one-time state to the encrypted cookie and issues a host-only HttpOnly session',async()=>{
    const h=harness();const {response,session,callback}=await h.login();
    expect(response.status).toBe(303);expect(response.headers.get('location')).toBe(origin+'/?setup_login=success');
    expect(response.headers.get('set-cookie')).toContain('__Host-bp_session=');expect(response.headers.get('set-cookie')).toContain('HttpOnly');expect(response.headers.get('set-cookie')).toContain('Secure');expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    expect(await (await h.handlers.accountStatus(new Request(base,{headers:{Cookie:session}}))).json()).toMatchObject({signed_in:true});
    const replay=await h.handlers.finishLogin(callback);expect(replay.headers.get('location')).toBe(origin+'/?setup_login=failed');expect(h.store.sessions.size).toBe(1);
  });
  it('rejects mismatched state before consuming a legitimate login attempt',async()=>{
    const h=harness();await h.handlers.beginLogin(req('/login'));const first=h.provider.authorize.mock.calls[0]![0];
    const another=await h.handlers.beginLogin(req('/login'));const second=h.provider.authorize.mock.calls[1]![0];
    const bad=await h.handlers.finishLogin(new Request(base+'/callback?code=x&state='+first.state,{headers:{Cookie:cookie(another)}}));
    expect(bad.headers.get('location')).toContain('setup_login=failed');expect(h.provider.authenticate).not.toHaveBeenCalled();
    const good=await h.handlers.finishLogin(new Request(base+'/callback?code=x&state='+second.state,{headers:{Cookie:cookie(another)}}));expect(good.headers.get('location')).toContain('setup_login=success');
  });
  it('expires and revokes account sessions on signout',async()=>{
    const h=harness();const {session}=await h.login();const out=await h.handlers.signOut(req('/logout',session));expect(out.status).toBe(200);expect(h.store.sessions.size).toBe(0);
    expect((await h.handlers.listSetups(new Request(base+'/setups',{headers:{Cookie:session}}))).status).toBe(401);
    const next=await h.login();h.setNow(Date.now()+8*86400000);expect((await h.handlers.listSetups(new Request(base+'/setups',{headers:{Cookie:next.session}}))).status).toBe(401);
  });
  it.each(['https://evil.test','https://phone.example.com.evil.test','null',''])('rejects cross-origin mutations %s',async badOrigin=>{
    const h=harness();const {session}=await h.login();
    expect((await h.handlers.saveSetup(req('/setups',session,{label:'x',settings},badOrigin))).status).toBe(403);
    expect((await h.handlers.signOut(req('/logout',session,undefined,badOrigin))).status).toBe(403);
    expect((await h.handlers.beginLogin(req('/login','',undefined,badOrigin))).status).toBe(403);
  });
});
describe('private saved setups',()=>{
  it('lists metadata only, restores explicitly, and isolates two users',async()=>{
    const h=harness(),a=await h.login('a'),b=await h.login('b');
    const saved=await h.handlers.saveSetup(req('/setups',a.session,{label:'Café test',settings}));expect(saved.status).toBe(201);const {id}=await saved.json();
    const listing=await (await h.handlers.listSetups(new Request(base+'/setups',{headers:{Cookie:a.session}}))).json();
    expect(listing.setups).toHaveLength(1);expect(JSON.stringify(listing)).not.toContain('contact');expect(JSON.stringify(listing)).not.toContain('payload');
    expect((await h.handlers.restoreSetup(req('/setups/'+id+'/restore',b.session),id)).status).toBe(404);
    expect((await h.handlers.removeSetup(req('/setups/'+id+'/remove',b.session),id)).status).toBe(404);
    expect(await (await h.handlers.restoreSetup(req('/restore',a.session),id)).json()).toMatchObject({settings,connection:null,needs_pairing:false});
    expect((await h.handlers.restoreSetup(new Request(base+'/restore',{headers:{Cookie:a.session}}),id)).status).toBe(405);
    expect((await h.handlers.removeSetup(req('/remove',a.session),id)).status).toBe(200);
    expect((await h.handlers.restoreSetup(req('/restore',a.session),id)).status).toBe(404);
  });
  it('saves only server-paired capabilities, encrypts them, and never revives expired/revoked access',async()=>{
    const h=harness(),a=await h.login();const id=crypto.randomUUID(),token='bp_conn_'+'x'.repeat(43);
    const row={id,webhook_url:'https://hooks.example.com/private?token=test-secret',phone_token_hash:await sha256Hex(token),verified_at:null as string|null,revoked_at:null as string|null,token_expires_at:new Date(Date.now()+86400000).toISOString()};h.store.connections.set(id,row);
    expect((await h.handlers.saveSetup(req('/setups',a.session,{label:'Paired',settings,connection:{id,token}}))).status).toBe(403);
    row.verified_at=new Date().toISOString();expect((await h.handlers.saveSetup(req('/setups',a.session,{label:'Bad token',settings,connection:{id,token:'bp_conn_'+'y'.repeat(43)}}))).status).toBe(403);
    const saved=await (await h.handlers.saveSetup(req('/setups',a.session,{label:'Paired',settings,connection:{id,token}}))).json();
    expect([...h.store.setups.values()][0]!.payload).not.toContain(token);
    expect(await (await h.handlers.restoreSetup(req('/restore',a.session),saved.id)).json()).toMatchObject({connection:{connectionId:id,phoneToken:token,apiBase:origin+'/api/public/v1'},needs_pairing:false});
    row.revoked_at=new Date().toISOString();expect(await (await h.handlers.restoreSetup(req('/restore',a.session),saved.id)).json()).toMatchObject({connection:null,needs_pairing:true,settings});
    row.revoked_at=null;row.token_expires_at=new Date(0).toISOString();expect(await (await h.handlers.restoreSetup(req('/restore',a.session),saved.id)).json()).toMatchObject({connection:null,needs_pairing:true});
  });
  it('caps saved entries and rejects secret-bearing or oversized input',async()=>{
    const h=harness(),a=await h.login();
    const results=await Promise.all(Array.from({length:25},(_,i)=>h.handlers.saveSetup(req('/setups',a.session,{label:'Setup '+i,settings}))));
    expect(results.filter(r=>r.status===201)).toHaveLength(20);expect(results.filter(r=>r.status===429)).toHaveLength(5);
    expect((await h.handlers.saveSetup(req('/setups',a.session,{label:'Secrets',settings,signingSecret:'never save'}))).status).toBe(400);
    expect((await h.handlers.saveSetup(req('/setups',a.session,{label:'x'.repeat(20000),settings}))).status).toBe(413);
  });
});
