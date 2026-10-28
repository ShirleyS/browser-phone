import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { boundedText, BodyLimitError } from '@/lib/shared/body';
import { readJson, deliverWebhook, getConfig } from '@/server/bp/core';
import { validVoiceConfig } from '@/lib/voice/validate';
import { redact } from '@/lib/shared/redact';
import { PhoneEngine, type Deps } from '@/lib/phone/engine';

const connection = { apiBase: 'https://phone.test/api/public/v1', connectionId: 'c', verified: true, phoneToken: 'bp_conn_test', webhookUrl: 'https://webhook.test' };
const voice = { provider: 'elevenlabs', transport: 'websocket', signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_123&token=abcdefgh' };
function harness(deadline = 60000) {
  let n = 0; let pollingStatus = 200;
  const end = vi.fn(async () => {}); const stop = vi.fn();
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.includes('/sessions') && !path.includes('/sessions/')) return Response.json({ id: 'session', phone_token: 'bp_phone_test', expires_at: new Date(Date.now()+120000).toISOString(), call_deadline: new Date(Date.now()+deadline).toISOString() });
    if (path.includes('/events')) return Response.json({ delivery: { ok: true }, voice });
    if (path.includes('/messages')) return Response.json({ messages: [], next_cursor: '0' }, { status: pollingStatus });
    return Response.json({});
  });
  const deps: Deps = { fetch: fetcher as typeof fetch, now: () => Date.now(), uuid: () => `id${++n}`, setTimeout, clearTimeout,
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream),
    startVoice: vi.fn(async (_cfg, cb) => { cb.onConnected(); return { end, setMuted() {}, setVolume() {} }; }) };
  const engine = new PhoneEngine(deps, { mode: 'live', connection });
  return { engine, deps, fetcher, end, stop, setPollStatus: (s: number) => { pollingStatus=s; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('bounded streaming', () => {
  it.each([16384,65536])('cancels a stream exceeding %i bytes', async limit => {
    const cancel=vi.fn(); const stream=new ReadableStream({ start(c) { c.enqueue(new Uint8Array(limit)); c.enqueue(new Uint8Array(1)); }, cancel });
    await expect(boundedText(stream,limit)).rejects.toBeInstanceOf(BodyLimitError); expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects missing-content-length request above 16KB', async () => {
    const r = await readJson(new Request('https://phone.test', { method:'POST', body:'x'.repeat(16385) }),16384);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.res.status).toBe(413);
  });
  it('caps configured request limit at 16KB', () => { vi.stubEnv('BP_MAX_BODY_BYTES','999999'); expect(getConfig().maxBodyBytes).toBe(16384); });
  it('cancels an oversized webhook response before decoding it', async () => {
    vi.stubEnv('BP_PUBLIC_ONLY_EGRESS','enforced');
    const cancel=vi.fn();
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async input => {
      if(String(input).includes('dns-query')) return Response.json({Answer:[{type:1,data:'8.8.8.8'}]});
      return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(65537));},cancel}));
    });
    const result=await deliverWebhook(getConfig(),'https://webhook.test','secret','message.sent',{});
    expect(result.error).toBe('response_too_large'); expect(cancel).toHaveBeenCalledOnce(); fetcher.mockRestore();
  });
  it('does not fetch at all without enforced egress' , async () => {
    vi.stubEnv('BP_PUBLIC_ONLY_EGRESS',''); const fetcher=vi.spyOn(globalThis,'fetch');
    expect((await deliverWebhook(getConfig(),'https://webhook.test','s','message.sent',{})).error).toBe('egress_not_enforced');
    expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
  });
});
describe('voice destination validation', () => {
  it('accepts documented provider signed websocket only', () => expect(validVoiceConfig(voice)).toBe(true));
  it.each([
    'wss://attacker.test/v1/convai/conversation?agent_id=agent_123&token=abcdefgh',
    'wss://api.elevenlabs.io:444/v1/convai/conversation?agent_id=agent_123&token=abcdefgh',
    'wss://user:pass@api.elevenlabs.io/v1/convai/conversation?agent_id=agent_123&token=abcdefgh',
    voice.signed_url+'#x', voice.signed_url+'&host=attacker.test',
    voice.signed_url+'&conversation_signature=abcdefgh',
    'wss://api.elevenlabs.io/other?agent_id=agent_123&token=abcdefgh',
    'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_123&token=x',
  ])('rejects unsafe signed URL %s', signed_url => expect(validVoiceConfig({...voice,signed_url})).toBe(false));

  it('accepts the documented ElevenLabs conversation_signature signed URL',()=>{
    expect(validVoiceConfig({...voice,signed_url:voice.signed_url.replace('token=','conversation_signature=')})).toBe(true);
  });
  it('fails closed for opaque WebRTC credentials', () => expect(validVoiceConfig({provider:'elevenlabs',transport:'webrtc',conversation_token:'opaque_destination'})).toBe(false));
  it('rejects attacker config before microphone', async () => {
    const h=harness(); h.fetcher.mockImplementation(async url => String(url).includes('/events') ? Response.json({delivery:{ok:true},voice:{...voice,signed_url:voice.signed_url.replace('api.elevenlabs.io','evil.test')}}) : Response.json({id:'session',phone_token:'x',expires_at:new Date(Date.now()+60000).toISOString()}));
    h.engine.startCall(); await vi.advanceTimersByTimeAsync(1); expect(h.deps.getUserMedia).not.toHaveBeenCalled(); await h.engine.dispose();
  });
});
describe('live operation teardown', () => {
  it('hung-up A deadline cannot end B; B ends only on its own deadline and chat survives', async () => {
    const h=harness(10000); let sessions=0;
    const normal=h.fetcher.getMockImplementation();
    h.fetcher.mockImplementation(async (url, init?: RequestInit) => {
      if (String(url).endsWith('/connections/c/sessions')) return Response.json({ id:`s${++sessions}`,phone_token:'bp_phone_test',expires_at:new Date(Date.now()+120000).toISOString(),call_deadline:JSON.parse(String(init?.body)).kind === 'call' ? new Date(Date.now()+10000).toISOString() : null });
      return normal ? normal(url) : Response.json({});
    });
    await h.engine.sendMessage('chat'); h.engine.startCall();await vi.advanceTimersByTimeAsync(1);
    await h.engine.hangup();await vi.advanceTimersByTimeAsync(1999);
    h.engine.startCall();await vi.advanceTimersByTimeAsync(1);
    expect(h.engine.state.call.status).toBe('active');
    await vi.advanceTimersByTimeAsync(8000);expect(h.engine.state.call.status).toBe('active');expect(h.end).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);expect(h.engine.state.call.status).toBe('ended');expect(h.end).toHaveBeenCalledTimes(2);
    await h.engine.sendMessage('still same chat');expect(sessions).toBe(3);await h.engine.dispose();
  });
  it('replay from ACTIVE live session closes voice, cancels polling and sends no further requests', async () => {
    const h=harness(); await h.engine.sendMessage('first'); h.engine.startCall(); await vi.advanceTimersByTimeAsync(1);
    expect(h.engine.state.call.live).toBe(true); expect(h.engine.resources.voice).not.toBeNull();
    h.engine.loadRecording([{t:0,type:'send',text:'replay'}]); h.fetcher.mockClear(); h.engine.replay();
    await vi.advanceTimersByTimeAsync(10000); expect(h.end).toHaveBeenCalledOnce(); expect(h.fetcher).not.toHaveBeenCalled(); expect(h.engine.resources.voice).toBeNull(); await h.engine.dispose();
  });
  it.each(['deadline','revoke','connection','mode','disconnect','401','410'])('terminates active audio on %s', async reason => {
    const h=harness(500); h.engine.startCall(); await vi.advanceTimersByTimeAsync(1); expect(h.engine.state.call.live).toBe(true);
    if(reason==='deadline') await vi.advanceTimersByTimeAsync(500);
    else if(reason==='revoke') await h.engine.revoke();
    else if(reason==='connection') h.engine.setConnection(null);
    else if(reason==='mode') h.engine.setMode('offline');
    else if(reason==='disconnect') h.engine.runScenario('disconnect');
    else { h.setPollStatus(Number(reason)); await h.engine.pollOnce(); }
    expect(h.engine.resources.voice).toBeNull(); expect(h.end).toHaveBeenCalledOnce(); expect(h.stop).toHaveBeenCalled(); await h.engine.dispose();
  });
  it('late voice resolution after replay is closed, never reconnects', async () => {
    const h=harness(); let resolve: ((v: any) => void) | undefined; let callbacks: any;
    h.deps.startVoice=vi.fn((_cfg,cb) => { callbacks=cb; return new Promise<import("@/lib/voice/adapter").VoiceSession>(r=>{resolve=r;}); });
    h.engine.startCall(); await vi.advanceTimersByTimeAsync(1); h.engine.loadRecording([{t:0,type:'send',text:'offline'}]); h.engine.replay();
    callbacks.onConnected(); resolve?.({end:h.end,setMuted(){},setVolume(){}}); await vi.advanceTimersByTimeAsync(1);
    expect(h.engine.state.call.live).toBe(false); expect(h.end).toHaveBeenCalledOnce(); await h.engine.dispose();
  });
  it('shares simultaneous first-send creation and sends both into exactly one session', async () => {
    const h=harness(); await Promise.all([h.engine.sendMessage('one'),h.engine.sendMessage('two')]);
    expect(h.fetcher.mock.calls.filter(([u])=>String(u).endsWith('/connections/c/sessions'))).toHaveLength(1);
    expect(h.fetcher.mock.calls.filter(([u])=>String(u).endsWith('/sessions/session/events'))).toHaveLength(2); await h.engine.dispose();
  });
  it('stops microphone tracks resolving after revocation', async () => {
    const h=harness(); let resolve: ((s:MediaStream)=>void)|undefined;
    h.deps.getUserMedia=vi.fn(()=>new Promise<MediaStream>(r=>{resolve=r;}));
    h.engine.startCall();await vi.advanceTimersByTimeAsync(1);await h.engine.revoke();
    resolve?.({getTracks:()=>[{stop:h.stop}]} as unknown as MediaStream);await vi.advanceTimersByTimeAsync(1);
    expect(h.stop).toHaveBeenCalledOnce();expect(h.deps.startVoice).not.toHaveBeenCalled();await h.engine.dispose();
  });
  it('rejects late creation after connection change' , async () => {
    const h=harness(); let resolve: ((r: Response)=>void)|undefined;
    h.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})); const sending=h.engine.sendMessage('old');
    h.engine.setConnection(null); resolve?.(Response.json({id:'stale',phone_token:'x',expires_at:new Date(Date.now()+60000).toISOString()})); await sending;
    expect(h.fetcher.mock.calls.filter(([u])=>String(u).includes('/stale/'))).toHaveLength(0); await h.engine.dispose();
  });
  it('redacts webhook query secrets nested in inspector and export input', async () => {
    const h=harness(); await h.engine.registerWebhook(connection.apiBase,'https://user:fake_password@webhook.test/path?token=fake_query_credential');
    const output=JSON.stringify(redact({nested:[h.engine.state.inspector]})); expect(output).not.toContain('fake_query_credential'); expect(output).not.toContain('fake_password'); await h.engine.dispose();
  });
});
