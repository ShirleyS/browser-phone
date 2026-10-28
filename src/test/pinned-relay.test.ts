// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {getRelayCapability,fetchThroughPinnedRelay,relayDiagnostic} from '@/server/bp/pinned-relay';
const origin='https://relay.example.com';
const capability={enabled:true,transport:'node-pinned-relay',allowed_origins:['https://hooks.example.com'],private_addresses_blocked:true,tls_verified:true,redirects_followed:false,max_body_bytes:16384,max_response_bytes:65536};
it('reports a bounded capability failure without enabling transport',async()=>{
 expect(await getRelayCapability(origin,vi.fn(async()=>{throw new Error('Unsupported cache mode');}))).toBeNull();
 expect(relayDiagnostic()).toEqual({stage:'fetch_error',detail:'Unsupported cache mode'});
});
it('fails closed for absent, unsafe or incomplete relay capability',async()=>{
 for(const value of [{},{...capability,enabled:false},{...capability,tls_verified:false},{...capability,redirects_followed:true}])expect(await getRelayCapability(origin,vi.fn(async()=>Response.json(value)))).toBeNull();
 const fetcher=vi.fn();expect(await getRelayCapability('http://localhost',fetcher)).toBeNull();expect(fetcher).not.toHaveBeenCalled();
});
it('relays only allowed targets and preserves signed bytes without forwarding credentials',async()=>{
 const fetcher=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>String(url).endsWith('/transport')?Response.json(capability):Response.json({received:JSON.parse(String(init?.body))}));
 const body=JSON.stringify({id:'test',type:'message.sent',data:{text:'hola'}});
 const response=await fetchThroughPinnedRelay(origin,'https://hooks.example.com/webhook/test',{headers:{'X-BrowserPhone-Event':'message.sent','X-BrowserPhone-Signature':'test-signature',Authorization:'never-forward'},body,timeoutMs:8000},fetcher);
 const {received}=await response.json();expect(received.body).toBe(body);expect(received.headers.Authorization).toBeUndefined();expect(fetcher.mock.calls.at(-1)?.[1]?.redirect).toBe('manual');
 await expect(fetchThroughPinnedRelay(origin,'https://evil.example/webhook/test',{headers:{},body,timeoutMs:8000},fetcher)).rejects.toThrow('not allowed');
});
it('uses edge-supported manual redirects and rejects capability and delivery redirects',async()=>{
 const denied=vi.fn(async(_url:unknown,init?:RequestInit)=>{expect(init?.redirect).toBe('manual');return new Response(null,{status:302,headers:{Location:'https://evil.example'}});});
 expect(await getRelayCapability(origin,denied)).toBeNull();
 const deliveryRedirect=vi.fn(async(url:unknown,init?:RequestInit)=>{expect(init?.redirect).toBe('manual');return String(url).endsWith('/transport')?Response.json(capability):new Response(null,{status:307});});
 await expect(fetchThroughPinnedRelay(origin,'https://hooks.example.com/webhook/test',{headers:{},body:'{}',timeoutMs:8000},deliveryRedirect)).rejects.toThrow('redirects are not allowed');
});
