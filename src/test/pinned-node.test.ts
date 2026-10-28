// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
// @ts-expect-error Node deployment script
import { createPinnedOutbound, installPinnedOutbound } from '../../scripts/pinned-outbound.mjs';
import { liveCapability, deliverWebhook, getConfig } from '@/server/bp/core';
const symbol=Symbol.for('browser-phone.node-pinned-outbound.v1');
it('pins checked address while preserving Host/SNI and certificate hostname verification',async()=>{
  let options:any;let call=0;
  const resolve=vi.fn(async()=>{call++;return call===1?['8.8.8.8']:['127.0.0.1'];});
  const send=vi.fn((opts:any,cb:any)=>{
    options=opts;const req=Object.assign(new EventEmitter(),{destroy:vi.fn(),end:()=>{
      const res=Object.assign(new EventEmitter(),{statusCode:200,destroy:vi.fn()});cb(res);res.emit('data',Buffer.from('{}'));res.emit('end');
    }});return req;
  });
  const adapter=createPinnedOutbound(resolve,send);
  const response=await adapter.fetch('https://webhook.example.com/path?x=1',{headers:{},body:'{}',timeoutMs:1000});expect(response.status).toBe(200);
  expect(options.hostname).toBe('webhook.example.com');expect(options.servername).toBe('webhook.example.com');expect(options.headers.Host).toBe('webhook.example.com');expect(options.rejectUnauthorized).toBe(true);expect(options.agent).toBe(false);
  const callback=vi.fn();options.lookup('webhook.example.com',{},callback);expect(callback).toHaveBeenCalledWith(null,'8.8.8.8',4);expect(resolve).toHaveBeenCalledTimes(1);
  expect(options.checkServerIdentity('8.8.8.8',{subjectaltname:'DNS:attacker.example.com'})).toBeInstanceOf(Error);
  await expect(adapter.fetch('https://webhook.example.com/path',{headers:{},body:'{}',timeoutMs:1000})).rejects.toThrow('Private');expect(send).toHaveBeenCalledTimes(1);
});
it('rejects mixed private/public answers, HTTPS credentials, localhost and insecure schemes',async()=>{
  const send=vi.fn();const adapter=createPinnedOutbound(async()=>['8.8.8.8','::1'],send);
  for(const u of ['https://webhook.example.com','https://user:pass@webhook.example.com','http://webhook.example.com','https://127.0.0.1'])await expect(adapter.fetch(u,{headers:{},body:'{}',timeoutMs:100})).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it('integration: delivery uses installed pinned transport with hosted attestation unset',async()=>{
  const globals=globalThis as unknown as Record<symbol,unknown>;
  const fetch=vi.fn(async()=>Response.json({reply:{text:'pinned'}}));
  globals[symbol]={resolve:async()=>['8.8.8.8'],fetch};
  try{const cfg={...getConfig(),publicOnlyEgress:false};expect(await liveCapability(cfg)).toMatchObject({enabled:true,transport:'node-pinned'});
    expect((await deliverWebhook(cfg,'https://webhook.example.com','fake_test_secret','message.sent',{id:'test'})).ok).toBe(true);expect(fetch).toHaveBeenCalledOnce();
  }finally{delete globals[symbol];}
});
it('startup refuses disabled TLS validation',()=>{
  const original=process.env['NODE_TLS_REJECT_UNAUTHORIZED'];process.env['NODE_TLS_REJECT_UNAUTHORIZED']='0';
  try{expect(()=>installPinnedOutbound()).toThrow('TLS verification');}finally{if(original===undefined)delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];else process.env['NODE_TLS_REJECT_UNAUTHORIZED']=original;}
});
it.each([204,205])('accepts a successful %i webhook response without a body',async(status)=>{
  const send=(_opts:unknown,cb:(response:unknown)=>void)=>Object.assign(new EventEmitter(),{
    destroy:vi.fn(),end:()=>{
      const res=Object.assign(new EventEmitter(),{statusCode:status,destroy:vi.fn()});
      cb(res);res.emit('end');
    },
  });
  const adapter=createPinnedOutbound(async()=>['8.8.8.8'],send);
  const response=await adapter.fetch('https://webhook.example.com/path',{headers:{},body:'{}',timeoutMs:1000});
  expect(response.status).toBe(status);expect(await response.text()).toBe('');
});
