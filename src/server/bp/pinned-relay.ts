import { boundedText } from '@/lib/shared/body';
import { checkWebhookUrl } from '@/lib/shared/net';

export type RelayCapability={enabled:true;transport:'node-pinned-relay';allowed_origins:string[];private_addresses_blocked:true;tls_verified:true;redirects_followed:false;max_body_bytes:number;max_response_bytes:number};
const cache=new Map<string,{expires:number;capability:RelayCapability}>();
let diagnostic: {stage:string;detail?:string}={stage:'not_checked'};
export function relayDiagnostic(){return diagnostic;}
export function checkedRelayOrigin(value:string):string|null {
 try{const checked=checkWebhookUrl(value);if(!checked.ok)return null;const url=checked.url;return url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password?url.origin:null;}catch{return null;}
}
export async function getRelayCapability(origin:string,fetcher:typeof fetch=fetch):Promise<RelayCapability|null>{
 if(!checkedRelayOrigin(origin)){diagnostic={stage:'invalid_origin'};return null;}
 const saved=cache.get(origin);if(fetcher===fetch&&saved&&saved.expires>Date.now())return saved.capability;
 try{
  const response=await fetcher(`${origin}/api/browser-phone/transport`,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(4000)});
  if(!response.ok){diagnostic={stage:'http_error',detail:String(response.status)};return null;}
  const value=JSON.parse(await boundedText(response.body,4096));
  if(value?.enabled!==true||value.transport!=='node-pinned-relay'||value.private_addresses_blocked!==true||value.tls_verified!==true||value.redirects_followed!==false||value.max_body_bytes!==16384||value.max_response_bytes!==65536||!Array.isArray(value.allowed_origins)||value.allowed_origins.length<1||value.allowed_origins.length>8||value.allowed_origins.some((item:unknown)=>typeof item!=='string'||!checkedRelayOrigin(item)))return null;
  if(fetcher===fetch){if(cache.size>4)cache.clear();cache.set(origin,{expires:Date.now()+60000,capability:value});}
  diagnostic={stage:'verified'};
  return value;
 }catch(error){diagnostic={stage:'fetch_error',detail:error instanceof Error?error.message.slice(0,160):'Unknown transport error'};return null;}
}
export async function relayTargetAllowed(origin:string,target:string,fetcher:typeof fetch=fetch):Promise<boolean>{
 const capability=await getRelayCapability(origin,fetcher);
 try{return !!capability?.allowed_origins.includes(new URL(target).origin);}catch{return false;}
}
export async function fetchThroughPinnedRelay(origin:string,url:string,init:{headers:Record<string,string>;body:string;timeoutMs:number},fetcher:typeof fetch=fetch):Promise<Response>{
 if(!await relayTargetAllowed(origin,url,fetcher))throw new Error('Relay destination not allowed');
 const response=await fetcher(`${origin}/api/browser-phone/relay`,{method:'POST',redirect:'manual',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,headers:{'X-BrowserPhone-Event':init.headers['X-BrowserPhone-Event'],'X-BrowserPhone-Signature':init.headers['X-BrowserPhone-Signature']},body:init.body}),signal:AbortSignal.timeout(Math.min(init.timeoutMs+2000,10000))});
 if(response.status>=300&&response.status<400)throw new Error('Relay redirects are not allowed');
 return response;
}
