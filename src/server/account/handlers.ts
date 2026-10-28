import { z } from 'zod';
import { boundedText, BodyLimitError } from '@/lib/shared/body';
import { randomToken, safeEqual, sha256Hex } from '@/server/bp/core';
import { saveSetupSchema, settingsSchema, type RestoredSetup } from '@/lib/account/types';
import { readAccountConfig, accountCookie, FLOW_SECONDS, LOGIN_SECONDS, type AccountConfig } from './config';
import { seal, openSealed } from './crypto';
import { createMojoOidc, type IdentityProvider, type LoginFlow } from './oidc';
import type { AccountStore, ConnectionRecord } from './store';

const headers={ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff' };
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const error=(status:number,code:string,message:string)=>respond({error:{code,message}},status);
const unavailable=()=>error(503,'account_unavailable','Saved setups are unavailable right now. You can continue without signing in.');
const uuid=z.string().uuid();
const flowSchema=z.object({state:z.string().regex(/^[A-Za-z0-9_-]{43}$/),nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),verifier:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:z.number().finite()}).strict();
const payloadSchema=z.object({settings:settingsSchema,connection:saveSetupSchema.shape.connection}).strict();
function readCookie(request:Request,name:string) {
  const matches=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
  return matches.length===1?matches[0]!.slice(name.length+1):'';
}
function cookie(cfg:AccountConfig,kind:'session'|'flow',value:string,seconds:number) { return `${accountCookie(cfg,kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${cfg.secure?'; Secure':''}`; }
function redirect(cfg:AccountConfig,result:'success'|'failed',session?:string) {
  const response=new Response(null,{status:303,headers:{...headers,Location:cfg.origin+'/?setup_login='+result}});
  if(session)response.headers.append('Set-Cookie',cookie(cfg,'session',session,LOGIN_SECONDS));
  response.headers.append('Set-Cookie',cookie(cfg,'flow','',0));return response;
}
function mutation(request:Request,cfg:AccountConfig) {
  if(request.method!=='POST')return error(405,'method_not_allowed','Use POST for this action.');
  if(request.headers.get('origin')!==cfg.origin)return error(403,'origin_rejected','Open this action from the phone itself.');
  return null;
}
function validConnection(row:ConnectionRecord|null,hash:string,now:number):row is ConnectionRecord {
  return !!row && !!row.verified_at && !row.revoked_at && Date.parse(row.token_expires_at)>now && safeEqual(row.phone_token_hash,hash);
}
type Dependencies={config:()=>AccountConfig|null;store:()=>Promise<AccountStore>;provider:(cfg:AccountConfig)=>IdentityProvider;now?:()=>number};
export function makeAccountHandlers(deps:Dependencies) {
  const now=deps.now??Date.now;
  async function signedIn(request:Request,cfg:AccountConfig,store:AccountStore) {
    const token=readCookie(request,accountCookie(cfg,'session'));
    if(!/^bp_acct_[A-Za-z0-9_-]{43}$/.test(token))return null;
    const hash=await sha256Hex(token),row=await store.session(hash);
    return row && Date.parse(row.expires_at)>now()?{owner:row.owner,hash}:null;
  }
  const guarded=(action:(request:Request,cfg:AccountConfig,store:AccountStore,owner:string)=>Promise<Response>,write:boolean)=>(request:Request)=>safe(async()=>{
    const cfg=deps.config();if(!cfg)return unavailable();
    if(write){const rejected=mutation(request,cfg);if(rejected)return rejected;}
    const store=await deps.store(),session=await signedIn(request,cfg,store);
    if(!session)return error(401,'sign_in_required','Sign in to access your saved setups.');
    return action(request,cfg,store,session.owner);
  });
  async function safe(action:()=>Promise<Response>) {try{return await action();}catch{return unavailable();}}
  async function body(request:Request) {
    try{return {ok:true as const,value:JSON.parse(await boundedText(request.body,16384)) as unknown};}
    catch(e){return {ok:false as const,response:error(e instanceof BodyLimitError?413:400,'invalid_request','The saved setup could not be read.')}}
  }
  return {
    accountStatus:(request:Request)=>safe(async()=>{
      const cfg=deps.config();if(!cfg)return respond({enabled:false,signed_in:false,reason:'not_configured'});
      const session=await signedIn(request,cfg,await deps.store());return respond({enabled:true,signed_in:!!session});
    }),
    beginLogin:(request:Request)=>safe(async()=>{
      const cfg=deps.config();if(!cfg)return unavailable();const rejected=mutation(request,cfg);if(rejected)return rejected;
      const flow:LoginFlow={state:randomToken('',32),nonce:randomToken('',32),verifier:randomToken('',32),expiresAt:now()+FLOW_SECONDS*1000};
      const location=await deps.provider(cfg).authorize(flow);
      const sealed=await seal(flow,cfg.key,'bp-flow:'+cfg.origin);
      await (await deps.store()).createState(await sha256Hex(flow.state),await sha256Hex(sealed),new Date(flow.expiresAt).toISOString());
      return new Response(null,{status:303,headers:{...headers,Location:location,'Set-Cookie':cookie(cfg,'flow',sealed,FLOW_SECONDS)}});
    }),
    finishLogin:async(request:Request)=>{
      const cfg=deps.config();if(!cfg)return unavailable();
      try {
        const value=readCookie(request,accountCookie(cfg,'flow'));if(value.length>4096)throw new Error('flow');
        const flow=flowSchema.parse(await openSealed(value,cfg.key,'bp-flow:'+cfg.origin));
        const callback=new URL(cfg.origin+'/api/public/v1/account/callback');callback.search=new URL(request.url).search;
        const states=callback.searchParams.getAll('state');
        if(flow.expiresAt<=now() || flow.expiresAt>now()+FLOW_SECONDS*1000 || states.length!==1 || !safeEqual(states[0]!,flow.state))throw new Error('flow');
        const store=await deps.store();
        if(!await store.consumeState(await sha256Hex(flow.state),await sha256Hex(value),new Date(now()).toISOString()))throw new Error('flow');
        const identity=await deps.provider(cfg).authenticate(callback,flow);
        const owner=await sha256Hex(JSON.stringify([identity.issuer,identity.subject]));
        const token=randomToken('bp_acct_');
        await store.createSession({token_hash:await sha256Hex(token),owner,expires_at:new Date(now()+LOGIN_SECONDS*1000).toISOString()});
        return redirect(cfg,'success',token);
      } catch {return redirect(cfg,'failed');}
    },
    signOut:(request:Request)=>safe(async()=>{
      const cfg=deps.config();if(!cfg)return unavailable();const rejected=mutation(request,cfg);if(rejected)return rejected;
      const store=await deps.store(),session=await signedIn(request,cfg,store);
      if(session)await store.deleteSession(session.hash);
      const response=respond({signed_in:false});response.headers.set('Set-Cookie',cookie(cfg,'session','',0));return response;
    }),
    listSetups:guarded(async(_request,_cfg,store,owner)=>respond({setups:await store.list(owner)}),false),
    saveSetup:guarded(async(request,cfg,store,owner)=>{
      const raw=await body(request);if(!raw.ok)return raw.response;
      const input=saveSetupSchema.safeParse(raw.value);if(!input.success)return error(400,'invalid_setup','Save only a name, phone settings and an optional paired connection.');
      const {label,settings,connection}=input.data;
      const hash=connection?await sha256Hex(connection.token):null;
      if(connection && !validConnection(await store.connection(connection.id),hash!,now()))return error(403,'pairing_required','Pair this webhook again before saving it.');
      const id=crypto.randomUUID(),payload=await seal({settings,connection},cfg.key,'bp-setup:'+owner+':'+id);
      const created_at=new Date(now()).toISOString();
      const saved=await store.save({id,owner,label,payload,connection_id:connection?.id??null,created_at},hash);
      if(saved==='limit')return error(429,'saved_setup_limit','You can save up to 20 setups. Remove one to save another.');
      if(saved==='connection_invalid')return error(403,'pairing_required','Pair this webhook again before saving it.');
      return respond({id,label,created_at},201);
    },true),
    restoreSetup:(request:Request,id:string)=>guarded(async(_request,cfg,store,owner)=>{
      if(!uuid.safeParse(id).success)return error(404,'not_found','Saved setup not found.');
      const row=await store.get(owner,id);if(!row)return error(404,'not_found','Saved setup not found.');
      const saved=payloadSchema.parse(await openSealed(row.payload,cfg.key,'bp-setup:'+owner+':'+id));
      const result:RestoredSetup={settings:saved.settings,connection:null,needs_pairing:!!saved.connection};
      if(saved.connection){
        const conn=await store.connection(saved.connection.id);
        if(saved.connection.id===row.connection_id && validConnection(conn,await sha256Hex(saved.connection.token),now())) {
          result.connection={apiBase:cfg.origin+'/api/public/v1',connectionId:conn.id,webhookUrl:conn.webhook_url,phoneToken:saved.connection.token,verified:true};result.needs_pairing=false;
        }
      }
      return respond(result);
    },true)(request),
    removeSetup:(request:Request,id:string)=>guarded(async(_request,_cfg,store,owner)=>{
      if(!uuid.safeParse(id).success || !await store.remove(owner,id))return error(404,'not_found','Saved setup not found.');
      return respond({removed:true});
    },true)(request),
  };
}
export const accountHandlers=makeAccountHandlers({config:readAccountConfig,provider:createMojoOidc,store:async()=>{
  const {createAccountStore}=await import('./store.supabase');return createAccountStore();
}});
