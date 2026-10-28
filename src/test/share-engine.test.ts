import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneEngine, type Deps } from '@/lib/phone/engine';
import { renderHook } from '@testing-library/react';
import { usePhoneEngine } from '@/components/phone/usePhone';
import { redact } from '@/lib/shared/redact';
const share={apiBase:'https://phone.test/api/public/v1',connectionId:'',webhookUrl:'',verified:true,phoneToken:'bp_share_'+'a'.repeat(43),shareId:'test-link'};
function fixture(exhausted=false,noVoice=false) {
 let count=0;const requests:{url:string;init:RequestInit|undefined}[]=[];
 const deps:Deps={now:Date.now,uuid:()=>`id${++count}`,setTimeout,clearTimeout,
  fetch:async(url,init)=>{
   requests.push({url:String(url),init});
   if(String(url).endsWith('/shares/test-link'))return Response.json({usage:{used:0,remaining:1,limit:1,reset_at:new Date(Date.now()+60000).toISOString(),verified:true}});
   if(String(url).endsWith('/sessions'))return exhausted?Response.json({error:{code:'share_exhausted',message:'This test link has no calls left.'}},{status:429}):Response.json({id:'private-session',phone_token:'bp_phone_secret',expires_at:new Date(Date.now()+60000).toISOString(),call_deadline:new Date(Date.now()+30000).toISOString()});
   if(String(url).endsWith('/events'))return Response.json(noVoice?{delivery:{ok:true}}:{delivery:{ok:true},voice:{provider:'elevenlabs',transport:'websocket',signed_url:'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_test&conversation_signature=abcdefgh'}});
   return Response.json({messages:[],next_cursor:'0'});
  },
  getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop(){}}]}) as unknown as MediaStream),
  startVoice:vi.fn(async(_config,callbacks)=>{callbacks.onConnected();return {end:async()=>{},setMuted(){},setVolume(){}};})};
 return {engine:new PhoneEngine(deps,{mode:'live',connection:share}),deps,requests};
}
function storage(){const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k),clear:()=>data.clear()};}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());});afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();localStorage.clear();sessionStorage.clear();vi.unstubAllGlobals();});
describe('shared phone engine',()=>{
 it('routes shared call reservation with the test capability while events use the private session capability',async()=>{
  const {engine,requests}=fixture();engine.startCall();await vi.advanceTimersByTimeAsync(5);
  const reservation=requests.find(r=>r.url.endsWith('/shares/test-link/sessions'));
  expect(reservation).toBeDefined();expect(new Headers(reservation?.init?.headers).get('authorization')).toBe('Bearer '+share.phoneToken);
  const event=requests.find(r=>r.url.endsWith('/sessions/private-session/events'));
  expect(new Headers(event?.init?.headers).get('authorization')).toBe('Bearer bp_phone_secret');
  expect(engine.state.call).toMatchObject({status:'active',live:true});
  expect(requests.some(r=>r.url.includes('/connections/'))).toBe(false);await engine.dispose();
 });
 it('ends an exhausted shared call with a clear error and never simulates success or requests the microphone',async()=>{
  const {engine,deps}=fixture(true);engine.startCall();await vi.advanceTimersByTimeAsync(5);
  expect(engine.state.call).toMatchObject({status:'ended',live:false});expect(engine.state.banner).toMatch(/no calls left/i);
  expect(deps.getUserMedia).not.toHaveBeenCalled();expect(deps.startVoice).not.toHaveBeenCalled();await engine.dispose();
 });
 it('reports missing voice setup without promising a simulated shared call',async()=>{
  const {engine}=fixture(false,true);engine.startCall();await vi.advanceTimersByTimeAsync(5);
  expect(engine.state.call.status).toBe('ended');expect(engine.state.banner).toMatch(/voice/i);expect(engine.state.banner).not.toMatch(/simulat/i);await engine.dispose();
 });
 it('reads the remaining shared allowance without asking for connection-owner usage',async()=>{
  const {engine,requests}=fixture();await engine.refreshUsage();expect(engine.state.usage).toMatchObject({limit:1,remaining:1});
  expect(requests.map(r=>r.url)).toEqual(['https://phone.test/api/public/v1/shares/test-link']);await engine.dispose();
 });
 it('redacts a share bearer and URL from inspector/export strings',()=>{
  const token='bp_share_'+'x'.repeat(43);expect(redact({message:token,link:'https://phone.test/test/id#key='+token})).toEqual({message:'[redacted]',link:'https://phone.test/test/id#[redacted]'});
 });
 it('isolates a tester hook from the owner’s stored connection and preferences',()=>{
  const owner={...share,connectionId:'owner',phoneToken:'bp_conn_private',shareId:undefined};
  localStorage.setItem('browser-phone:prefs',JSON.stringify({contact:{name:'Owner private',number:'123'},lang:'es',agentId:'agent_owner'}));
  sessionStorage.setItem('browser-phone:connection',JSON.stringify(owner));
  const prefs=localStorage.getItem('browser-phone:prefs'),conn=sessionStorage.getItem('browser-phone:connection');
  const {result,unmount}=renderHook(()=>usePhoneEngine({isolated:true}));
  expect(result.current.state.connection).toBeNull();expect(result.current.state.agentId).toBe('');expect(result.current.state.contact.name).not.toBe('Owner private');
  expect(localStorage.getItem('browser-phone:prefs')).toBe(prefs);expect(sessionStorage.getItem('browser-phone:connection')).toBe(conn);unmount();
 });
});
