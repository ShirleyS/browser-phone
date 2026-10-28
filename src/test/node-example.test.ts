// @vitest-environment node
import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
// @ts-expect-error standalone JS example
import { verify, callbackUrl } from '../../examples/node-webhook/security.mjs';
const sid='11111111-1111-4111-8111-111111111111'; const origin='https://phone.example.com'; const secret='test_signing_secret';
const evt={id:'test',type:'message.sent',session_id:sid,reply_url:`${origin}/api/public/v1/sessions/${sid}/messages`,callback_token:'bp_cb_fake_callback',data:{text:'hello'}};
function sign(raw:string) { const t=Math.floor(Date.now()/1000); return `t=${t},v1=${crypto.createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex')}`; }
it('missing/malformed/nonfinite signature fails closed', () => {
  for(const h of [undefined,'','t=NaN,v1=x','t=Infinity,v1=x','t=123,v1=xx',sign('{}').slice(0,-1)]) expect(verify('{}',h,secret)).toBe(false);
  expect(verify('{}',sign('{}'),secret)).toBe(true); expect(verify('{}',sign('{}'),'')).toBe(false);
});
it('callback exact HTTPS origin/path and no redirects/query/credentials/fragments', () => {
  expect(callbackUrl(evt,origin)).toBe(evt.reply_url);
  for(const url of [evt.reply_url+'?token=fake',evt.reply_url+'#f',evt.reply_url.replace('phone.example.com','evil.test'),evt.reply_url.replace(sid,'other'),evt.reply_url.replace('https://','https://user:pass@')]) expect(()=>callbackUrl({...evt,reply_url:url},origin)).toThrow();
});
it('runs actual Node sample and checker without crashing on malformed JSON or delayed rejection', async () => {
  const child=spawn(process.execPath,['examples/node-webhook/server.mjs'],{env:{...process.env,PORT:'3397',BP_SIGNING_SECRET:secret,BP_PHONE_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise<void>((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject);});
    const url='http://127.0.0.1:3397';
    expect((await fetch(url,{method:'POST',body:'{'})).status).toBe(400);
    expect((await fetch(url,{method:'POST',body:'x'.repeat(16385)})).status).toBe(413);
    expect((await fetch(url,{method:'POST',body:JSON.stringify(evt)})).status).toBe(401);
    expect((await fetch(url,{method:'POST',body:JSON.stringify({...evt,type:'connection.pairing',code:'ABCDEFGH'})})).status).toBe(200);
    const invalid=JSON.stringify({...evt,reply_url:'https://evil.test/'});
    expect((await fetch(url,{method:'POST',body:invalid,headers:{'X-BrowserPhone-Signature':sign(invalid)}})).status).toBe(400);
    const checker=spawn(process.execPath,['scripts/check-webhook.mjs',url,secret,origin],{stdio:'ignore'});
    const code=await new Promise<number|null>(resolve=>checker.on('exit',resolve)); expect(code).toBe(0);
    await new Promise(r=>setTimeout(r,400)); expect(child.exitCode).toBeNull();
    expect((await fetch(url,{method:'POST',body:'{'})).status).toBe(400);
  } finally { child.kill(); }
},15000);
it('n8n verification requires raw signed body, validates destination and emits only inline reply', async () => {
  const script=readFileSync('examples/n8n/verify.cjs','utf8');
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('$input','$env','require',script);
  const raw=JSON.stringify(evt); const item={binary:{data:{}},json:{headers:{'x-browserphone-signature':sign(raw)}}};
  const context={helpers:{getBinaryDataBuffer:async()=>Buffer.from(raw)}};
  expect(await run.call(context,{first:()=>item},{BP_SIGNING_SECRET:secret,BP_PHONE_ORIGIN:origin},()=>crypto)).toMatchObject([{json:{reply:{text:'n8n got: hello'}}}]);
  await expect(run.call(context,{first:()=>item},{BP_PHONE_ORIGIN:origin},()=>crypto)).rejects.toThrow('Signature required');
  await expect(run.call(context,{first:()=>item},{BP_SIGNING_SECRET:secret,BP_PHONE_ORIGIN:'https://evil.test'},()=>crypto)).rejects.toThrow('Invalid callback');
});

it('copyable Docs verifier returns false for missing and malformed headers', () => {
  const docs=readFileSync('src/components/workbench/Docs.tsx','utf8');
  const start=docs.indexOf('function verify(raw, header, secret');
  const end=docs.indexOf('\n}',start)+2;
  const code=docs.slice(start,end).replace(/\\`/g,'`').replace(/\\\$/g,'$').replace(/\\\\d/g,'\\d');
  const fn=new Function('crypto',code+'; return verify;')(crypto);
  for(const header of [undefined,'','t=NaN,v1=x','t=123,v1=x',sign('{}').slice(0,-1)])expect(fn('{}',header,secret)).toBe(false);
  expect(fn('{}',sign('{}'),secret)).toBe(true);
});
