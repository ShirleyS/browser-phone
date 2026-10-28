// Framework-agnostic phone engine. All side effects (network, timers, mic, voice)
// are injected so offline mode and replay can be proven to make no external calls.
import { redact } from "@/lib/shared/redact";
import { callReducer, cleanupCall, initialCall, newResources, type CallAction, type CallResources } from "./call";
import { demoReply, DEMO_PRESET } from "./demo";
import { t } from "./i18n";
import type {
  CallState, ChatItem, ChatLink, Contact, InspectorEntry, Lang, LiveConnection, Mode, RecordedEvent, ScenarioName,
} from "./types";
import type { VoiceConfig, VoiceSession, VoiceCallbacks } from "@/lib/voice/adapter";
import { validVoiceConfig } from '@/lib/voice/validate';
import { boundedText } from '@/lib/shared/body';

export type Deps = {
  fetch: typeof fetch;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
  getUserMedia: () => Promise<MediaStream>;
  startVoice: (cfg: VoiceConfig, cb: VoiceCallbacks) => Promise<VoiceSession>;
  uuid: () => string;
};

type LiveSession = { id: string; kind: "chat" | "call"; phoneToken: string; cursor: string; expiresAt: string; callDeadline: string | null };

export type Usage = { used: number; limit: number; remaining: number; reset_at: string; verified: boolean } | null;

export type PhoneState = {
  mode: Mode;
  lang: Lang;
  contact: Contact;
  chat: ChatItem[];
  call: CallState;
  inspector: InspectorEntry[];
  connection: LiveConnection | null;
  usage: Usage;
  agentId: string;
  typing: boolean;
  netDown: boolean;
  failNext: boolean;
  recording: RecordedEvent[];
  isRecording: boolean;
  replaying: boolean;
  view: "chat" | "call";
  banner: string | null;
};

export function initialState(): PhoneState {
  return {
    mode: "offline", lang: "en", contact: { ...DEMO_PRESET }, chat: [], call: initialCall, inspector: [],
    connection: null, usage: null, agentId: "", typing: false, netDown: false, failNext: false,
    recording: [], isRecording: false, replaying: false, view: "chat", banner: null,
  };
}

export class PhoneEngine {
  state: PhoneState;
  private listeners = new Set<() => void>();
  private res: CallResources = newResources();
  private chatTimers = new Set<ReturnType<typeof setTimeout>>();
  private chatSession: LiveSession | null = null;
  private callSession: LiveSession | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private recordStart = 0;
  private generation = 0;
  private callGeneration = 0;
  private pendingChat: Promise<LiveSession | null> | null = null;
  private pendingRequests = new Set<AbortController>();
  private deadlines = new Set<ReturnType<typeof setTimeout>>();
  private callDeadlines = new Set<ReturnType<typeof setTimeout>>();
  onOutbound?: ((type: string, payload: Record<string, unknown>) => void) | undefined;

  constructor(private deps: Deps, init?: Partial<PhoneState>) {
    this.state = { ...initialState(), ...init };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(p: Partial<PhoneState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }
  private dispatchCall(a: CallAction) {
    this.set({ call: callReducer(this.state.call, a) });
    this.onOutbound?.("call_state", { status: this.state.call.status });
  }
  private get tr() {
    return t(this.state.lang);
  }
  private later(fn: () => void, ms: number, bucket: Set<ReturnType<typeof setTimeout>> = this.chatTimers) {
    const id = this.deps.setTimeout(() => {
      bucket.delete(id);
      fn();
    }, ms);
    bucket.add(id);
    return id;
  }
  private record(ev: Omit<RecordedEvent, "t"> & Record<string, unknown>) {
    if (!this.state.isRecording || this.state.replaying) return;
    this.set({ recording: [...this.state.recording, { ...(ev as object), t: this.deps.now() - this.recordStart } as RecordedEvent] });
  }

  // ---------- settings ----------
  private invalidateLive(reason: string) {
    this.generation++; this.callGeneration++;
    this.pendingChat = null;
    for (const controller of this.pendingRequests) controller.abort();
    this.pendingRequests.clear();
    this.stopPolling();
    for (const timer of this.deadlines) this.deps.clearTimeout(timer);
    this.deadlines.clear();
    this.clearCallDeadlines();
    this.chatSession = null; this.callSession = null;
    void cleanupCall(this.res);
    this.dispatchCall({ type: 'hangup', reason });
  }
  setLang(lang: Lang) { this.set({ lang }); }
  setContact(contact: Contact) { this.set({ contact: { name: contact.name.slice(0, 60), number: contact.number.slice(0, 30) } }); }
  setAgentId(agentId: string) { this.set({ agentId: agentId.trim().slice(0, 128) }); }
  setView(view: "chat" | "call") { this.set({ view }); }
  setMode(mode: Mode) {
    if (mode === this.state.mode) return;
    this.invalidateLive('mode_change');
    this.set({ mode, banner: null });
  }
  setConnection(c: LiveConnection | null) {
    this.invalidateLive('connection_change');
    this.set({ connection: c, usage: null });
  }
  clearChat() {
    this.clearChatTimers();
    this.set({ chat: [], typing: false });
  }

  // ---------- chat ----------
  private push(item: ChatItem) {
    if (this.state.chat.some((c) => c.id === item.id)) return;
    this.set({ chat: [...this.state.chat, item] });
    if (item.from === "them") this.onOutbound?.("message", { id: item.id, text: item.text, kind: item.kind });
  }
  private patch(id: string, p: Partial<ChatItem>) {
    this.set({ chat: this.state.chat.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  }
  private system(text: string) {
    this.push({ id: `sys-${this.deps.uuid()}`, from: "them", kind: "system", text, at: this.deps.now(), simulated: true });
  }

  async sendMessage(text: string, retryId?: string) {
    const body = text.trim().slice(0, 4000);
    if (!body) return;
    const id = retryId ?? `m-${this.deps.uuid()}`;
    if (retryId) this.patch(id, { status: "sending", error: undefined });
    else {
      this.record({ type: "send", text: body });
      this.push({ id, from: "me", kind: "message", text: body, at: this.deps.now(), status: "sending", simulated: this.state.mode === "offline" });
    }
    if (this.state.mode === "offline" || this.state.replaying) return this.sendOffline(id, body);
    return this.sendLive(id, body);
  }

  private sendOffline(id: string, body: string) {
    if (this.state.netDown || this.state.failNext) {
      this.set({ failNext: false });
      this.later(() => this.patch(id, { status: "failed", error: this.state.netDown ? "offline" : "simulated_failure" }), 500);
      return;
    }
    this.later(() => this.patch(id, { status: "sent" }), 250);
    this.later(() => this.patch(id, { status: "delivered" }), 600);
    this.later(() => { this.patch(id, { status: "read" }); this.set({ typing: true }); }, 1000);
    this.later(() => {
      const r = demoReply(body, this.state.lang);
      this.set({ typing: false });
      this.push({ id: `r-${id}`, from: "them", kind: "message", text: r.text, link: r.link, at: this.deps.now(), simulated: true });
    }, 2000);
  }

  private async sendLive(id: string, body: string) {
    const gen = this.generation;
    const s = await this.ensureSession("chat");
    if (gen !== this.generation) return;
    if (!s) return this.patch(id, { status: "failed", error: "no_session" });
    const r = await this.api("message.sent", "POST", `/sessions/${s.id}/events`, s.phoneToken, { id, type: "message.sent", text: body });
    if (gen !== this.generation) return;
    const delivery = (r.body as { delivery?: { ok: boolean; error?: string } } | null)?.delivery;
    if (r.ok && delivery?.ok) this.patch(id, { status: "delivered" });
    else this.patch(id, { status: "failed", error: delivery?.error ?? r.error ?? `http_${r.status}` });
    if ((r.body as { duplicate?: boolean })?.duplicate && delivery?.ok) this.patch(id, { status: "delivered" });
    void this.pollOnce();
  }

  // ---------- scenarios (always local + labeled simulated) ----------
  runScenario(name: ScenarioName) {
    this.record({ type: "scenario", name });
    const es = this.state.lang === "es";
    const now = this.deps.now();
    const them = (text: string, link?: ChatLink) => this.push({ id: `s-${this.deps.uuid()}`, from: "them", kind: "message", text, link, at: this.deps.now(), simulated: true });
    switch (name) {
      case "incoming_call":
        this.incomingCall();
        break;
      case "incoming_message":
        them(es ? "Hola 👋 tu pedido salió a reparto." : "Hi 👋 your order is out for delivery.");
        break;
      case "delayed_reply":
        this.set({ typing: true });
        this.later(() => { this.set({ typing: false }); them(es ? "Perdón la demora — ya revisé tu pedido." : "Sorry for the wait — I checked your order."); }, 4000);
        break;
      case "disconnect":
        this.set({ netDown: !this.state.netDown });
        if (this.state.netDown) this.invalidateLive('disconnect');
        this.system(this.state.netDown ? this.tr.disconnected : this.tr.online);
        break;
      case "failed_delivery":
        this.set({ failNext: true });
        this.system(es ? "El próximo mensaje fallará (simulado)." : "Next message will fail (simulated).");
        break;
      case "receipt_link":
        them(es ? "Tu recibo está listo." : "Your receipt is ready.", { label: es ? "Ver recibo (simulado)" : "View receipt (simulated)", url: "https://example.com/receipt/demo-1042", simulated: true });
        break;
      case "payment_link":
        them(es ? "Completa tu pago aquí." : "Complete your payment here.", { label: es ? "Pagar $249.00 MXN (simulado)" : "Pay $249.00 MXN (simulated)", url: "https://example.com/pay/demo-1042", simulated: true });
        break;
    }
    void now;
  }

  receiveImported(m: Omit<ChatItem, "simulated" | "error"> & { simulated?: boolean }) {
    this.push({ ...m, simulated: true });
  }

  receiveSimulated(text: string) {
    this.push({ id: `s-${this.deps.uuid()}`, from: "them", kind: "message", text: text.slice(0, 4000), at: this.deps.now(), simulated: true });
  }

  // ---------- calls ----------
  incomingCall() {
    if (this.state.call.status !== "idle" && this.state.call.status !== "ended") return;
    this.record({ type: "call", action: "incoming" });
    this.dispatchCall({ type: "incoming" });
    this.set({ view: "call" });
    this.later(() => { if (this.state.call.status === "incoming") this.decline("missed"); }, 30000, this.res.timers);
  }

  startCall() {
    if (this.state.call.status !== "idle" && this.state.call.status !== "ended") return;
    this.record({ type: "call", action: "start" });
    this.dispatchCall({ type: "dial" });
    this.set({ view: "call" });
    if (this.isLiveVoicePossible()) {
      void this.connectLiveCall();
    } else {
      this.later(() => { if (this.state.call.status === "outgoing") this.dispatchCall({ type: "connected", at: this.deps.now(), live: false, note: this.tr.simulatedCall }); }, 2200, this.res.timers);
    }
  }

  answer() {
    if (this.state.call.status !== "incoming") return;
    this.record({ type: "call", action: "answer" });
    if (this.isLiveVoicePossible()) void this.connectLiveCall();
    else this.dispatchCall({ type: "connected", at: this.deps.now(), live: false, note: this.tr.simulatedCall });
  }

  decline(reason = "declined") {
    if (this.state.call.status !== "incoming" && this.state.call.status !== "outgoing") return;
    this.record({ type: "call", action: "decline" });
    this.callGeneration++;
    void cleanupCall(this.res);
    this.dispatchCall({ type: "decline" });
    this.set({ call: { ...this.state.call, endReason: reason } });
    this.later(() => { if (this.state.call.status === "ended") { this.dispatchCall({ type: "reset" }); this.set({ view: "chat" }); } }, 1500);
  }

  toggleMute() {
    this.dispatchCall({ type: "toggleMute" });
    this.res.voice && (this.res.voice as VoiceSession).setMuted?.(this.state.call.muted);
  }
  toggleSpeaker() {
    this.dispatchCall({ type: "toggleSpeaker" });
    this.res.voice && (this.res.voice as VoiceSession).setVolume?.(this.state.call.speaker ? 1 : 0.6);
  }

  async hangup(reason = "hangup") {
    const callGen = ++this.callGeneration;
    this.clearCallDeadlines();
    if (this.state.call.status === "idle" || this.state.call.status === "ended") return;
    this.record({ type: "call", action: "hangup" });
    const s = this.callSession;
    this.callSession = null;
    this.dispatchCall({ type: "hangup", reason });
    await cleanupCall(this.res);
    if (s && this.state.mode === "live" && !this.state.replaying) {
      await this.api("call.end", "POST", `/sessions/${s.id}/events`, s.phoneToken, { id: `ev-${this.deps.uuid()}`, type: "call.end" });
    }
    this.later(() => { if (callGen === this.callGeneration && this.state.call.status === "ended") { this.dispatchCall({ type: "reset" }); this.set({ view: "chat" }); } }, 1500);
  }

  private clearCallDeadlines() {
    for (const timer of this.callDeadlines) this.deps.clearTimeout(timer);
    this.callDeadlines.clear();
  }

  private isLiveVoicePossible() {
    return this.state.mode === "live" && !this.state.replaying && (!!this.state.connection?.verified || !!this.state.agentId);
  }

  private async connectLiveCall() {
    const gen = this.generation; const callGen = ++this.callGeneration;
    const voiceError = (kind: 'micDenied' | 'voiceFailed' | 'noVoice') => this.state.connection?.shareId ? this.tr.sharedVoice[kind] : this.tr[kind];
    const current = () => gen === this.generation && callGen === this.callGeneration && !this.state.replaying && this.state.mode === 'live';
    this.dispatchCall({ type: "connecting", live: true });
    let voice: VoiceConfig | null = null;
    if (this.state.connection?.verified) {
      const s = await this.ensureSession("call");
      if (!current()) return;
      if (!s) return this.fallbackSimulated(this.state.connection?.shareId ? (this.state.banner ?? this.tr.quota) : this.tr.quota);
      this.callSession = s;
      const expiry = Math.min(Date.parse(s.expiresAt), s.callDeadline ? Date.parse(s.callDeadline) : Infinity);
      this.later(() => { if (current() && this.callSession === s) void this.hangup('call_deadline'); }, Math.max(0, expiry - this.deps.now()), this.callDeadlines);
      const r = await this.api("call.start", "POST", `/sessions/${s.id}/events`, s.phoneToken, { id: `ev-${this.deps.uuid()}`, type: "call.start" });
      if (!current()) return;
      const b = r.body as { delivery?: { ok: boolean; error?: string }; voice?: VoiceConfig; contract_error?: string } | null;
      if (!r.ok || !b?.delivery?.ok) return this.fallbackSimulated(`${voiceError('voiceFailed')} (${b?.delivery?.error ?? r.error ?? r.status})`);
      voice = b.voice ?? null;
      if (!voice && b.contract_error) return this.fallbackSimulated(`${voiceError('noVoice')} (${b.contract_error})`);
      this.startPolling();
    }
    if (!voice && this.state.agentId) voice = { provider: "elevenlabs", agent_id: this.state.agentId };
    if (!voice) return this.fallbackSimulated(voiceError('noVoice'));
    if (!validVoiceConfig(voice)) return this.fallbackSimulated('Invalid voice configuration');
    if (!current()) return;
    // Public-agent sessions also have a local upper bound. Provider-side limits
    // are mandatory; a hostile browser can ignore any client timer.
    this.later(() => { if (current()) void this.hangup('call_deadline'); }, 900000, this.callDeadlines);
    if ((this.state.call.status as string) !== "connecting") return; // hung up meanwhile
    // Microphone is requested only now — after the user dialed or answered.
    try {
      const stream = await this.deps.getUserMedia();
      if (!current()) { stream.getTracks().forEach(tr => tr.stop()); return; }
      this.res.stream = stream;
    } catch {
      if (!current()) return;
      return this.fallbackSimulated(voiceError('micDenied'));
    }
    if ((this.state.call.status as string) !== "connecting") return void cleanupCall(this.res);
    try {
      const session = await this.deps.startVoice(voice, {
        onConnected: () => { if (current()) this.dispatchCall({ type: "connected", at: this.deps.now(), live: true, note: this.tr.liveCall }); },
        onDisconnected: (why) => { if (current()) this.invalidateLive(`provider_${why}`); },
        onTranscript: (role, text) => { if (current()) this.push({ id: `tx-${this.deps.uuid()}`, from: role === "agent" ? "them" : "me", kind: "transcript", text, at: this.deps.now(), simulated: false }); },
        onError: (m) => { if (current()) this.set({ banner: `${voiceError('voiceFailed')} ${m}` }); },
      });
      const st = this.state.call.status as string;
      if (!current() || st === "idle" || st === "ended") {
        await session.end();
        return;
      }
      this.res.voice = session;
      // SDK may have opened its own stream; release ours.
      this.res.stream?.getTracks().forEach((tr) => tr.stop());
      this.res.stream = null;
    } catch (e) {
      if (!current()) return;
      return this.fallbackSimulated(`${voiceError('voiceFailed')} ${(e as Error)?.message ?? ""}`.trim());
    }
  }

  private fallbackSimulated(note: string) {
    if (this.state.connection?.shareId) {
      this.set({ banner: note });
      void this.hangup('call_failed');
      return;
    }
    void cleanupCall(this.res);
    if (this.state.call.status === "idle" || this.state.call.status === "ended") return;
    this.dispatchCall({ type: "connected", at: this.deps.now(), live: false, note });
  }

  // ---------- live API ----------
  private async api(label: string, method: string, path: string, token: string | null, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const c = this.state.connection;
    const base = c?.apiBase ?? "";
    const url = `${base}${path}`;
    const start = this.deps.now();
    const entry: InspectorEntry = {
      id: this.deps.uuid(), at: start, label, method, url: redact(url),
      request: redact({ headers: { Authorization: token ? `Bearer ${token}` : undefined, ...extraHeaders }, body }),
      status: null, ok: false, latencyMs: null, response: null, error: null, simulated: false,
    };
    let status: number | null = null;
    let parsed: unknown = null;
    let error: string | null = null;
    const gen = this.generation;
    const controller = new AbortController(); this.pendingRequests.add(controller);
    try {
      const r = await this.deps.fetch(url, {
        signal: controller.signal,
        method,
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        body: body ? JSON.stringify(body) : null,
      });
      status = r.status;
      const text = await boundedText(r.body, 65536);
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text.slice(0, 2000); }
      if (!r.ok) error = (parsed as { error?: { code?: string } })?.error?.code ?? `http_${r.status}`;
    } catch (e) {
      error = (e as Error)?.message || "network_error";
    }
    this.pendingRequests.delete(controller);
    if (gen !== this.generation) return { ok: false, status: null, body: null, error: 'stale_operation' };
    const ok = status !== null && status >= 200 && status < 300 && !error;
    if (label !== "inbox.poll" || !ok || ((parsed as { messages?: unknown[] })?.messages?.length ?? 0) > 0) {
      this.set({ inspector: [{ ...entry, status, ok, latencyMs: this.deps.now() - start, response: redact(parsed), error }, ...this.state.inspector].slice(0, 200) });
    }
    return { ok, status, body: parsed, error };
  }

  async registerWebhook(apiBase: string, webhookUrl: string) {
    this.setConnection({ apiBase, connectionId: "", webhookUrl, verified: false, phoneToken: "" });
    const gen = this.generation;
    const r = await this.api("connections.create", "POST", "/connections", null, { webhook_url: webhookUrl });
    const b = r.body as { id?: string; phone_token?: string; signing_secret?: string; pairing?: { delivered: boolean; error?: string }; error?: { message?: string } } | null;
    if (gen !== this.generation) return { ok: false as const, error: 'stale_operation' };
    if (!r.ok || !b?.id || !b.phone_token) {
      this.set({ connection: null });
      return { ok: false as const, error: b?.error?.message ?? r.error ?? "failed" };
    }
    this.set({ connection: { apiBase, connectionId: b.id, webhookUrl, verified: false, phoneToken: b.phone_token, signingSecret: b.signing_secret } });
    return { ok: true as const, pairing: b.pairing };
  }

  async verify(code: string) {
    const gen = this.generation;
    const c = this.state.connection;
    if (!c) return { ok: false, error: "no_connection" };
    const r = await this.api("connections.verify", "POST", `/connections/${c.connectionId}/verify`, c.phoneToken, { code });
    if (gen !== this.generation) return { ok: false, error: "stale_operation" };
    if (r.ok) {
      this.set({ connection: { ...c, verified: true } });
      await this.refreshUsage();
      return { ok: true };
    }
    return { ok: false, error: (r.body as { error?: { message?: string } })?.error?.message ?? r.error ?? "failed" };
  }

  async revoke() {
    const c = this.state.connection;
    this.invalidateLive('revoked');
    if (c?.connectionId && c.phoneToken && !c.shareId) await this.api("connections.revoke", "POST", `/connections/${c.connectionId}/revoke`, c.phoneToken);
    this.setConnection(null);
  }

  async refreshUsage() {
    const gen = this.generation;
    const c = this.state.connection;
    if (!c?.connectionId && !c?.shareId) return;
    const r = await this.api("connections.usage", "GET", c.shareId ? `/shares/${c.shareId}` : `/connections/${c.connectionId}/usage`, c.phoneToken);
    if (gen === this.generation && r.ok) this.set({ usage: c.shareId ? (r.body as { usage: Usage }).usage : r.body as Usage });
  }

  private ensureSession(kind: 'chat' | 'call'): Promise<LiveSession | null> {
    if (kind !== 'chat') return this.createLiveSession(kind);
    if (this.pendingChat) return this.pendingChat;
    const pending = this.createLiveSession(kind);
    this.pendingChat = pending;
    void pending.finally(() => { if (this.pendingChat === pending) this.pendingChat = null; });
    return pending;
  }
  private async createLiveSession(kind: "chat" | "call"): Promise<LiveSession | null> {
    const gen = this.generation;
    const callGen = this.callGeneration;
    if (kind === "chat" && this.chatSession && new Date(this.chatSession.expiresAt).getTime() > this.deps.now() + 5000) return this.chatSession;
    const c = this.state.connection;
    if (!c?.verified) {
      this.system(this.state.lang === "es" ? "Conecta y verifica tu webhook primero." : "Connect and verify your webhook first.");
      return null;
    }
    const key = `idem-${this.deps.uuid()}`;
    const path = c.shareId ? `/shares/${c.shareId}/sessions` : `/connections/${c.connectionId}/sessions`;
    let r = await this.api("sessions.create", "POST", path, c.phoneToken, { kind }, { "Idempotency-Key": key });
    if (gen !== this.generation || (kind === 'call' && callGen !== this.callGeneration)) return null;
    if (r.status === null) r = await this.api("sessions.create (retry)", "POST", path, c.phoneToken, { kind }, { "Idempotency-Key": key });
    if (gen !== this.generation || (kind === 'call' && callGen !== this.callGeneration)) return null;
    const b = r.body as { id?: string; phone_token?: string; expires_at?: string; call_deadline?: string | null; error?: { code?: string; message?: string; reset_at?: string } } | null;
    void this.refreshUsage();
    if (!r.ok || !b?.id || !b.phone_token || !b.expires_at) {
      const msg = b?.error?.code === "quota_exceeded" ? `${this.tr.quota} — ${this.tr.resets} ${b.error.reset_at}` : (b?.error?.message ?? r.error ?? "session_failed");
      if (c.shareId) this.set({ banner: msg });
      this.system(msg);
      return null;
    }
    const s: LiveSession = { id: b.id, kind, phoneToken: b.phone_token, cursor: "0", expiresAt: b.expires_at, callDeadline: b.call_deadline ?? null };
    const expiry = Math.min(Date.parse(s.expiresAt), s.callDeadline ? Date.parse(s.callDeadline) : Infinity);
    if (!Number.isFinite(expiry) || expiry <= this.deps.now()) return null;
    if (kind === "chat") {
      this.chatSession = s;
      this.later(() => { if (gen === this.generation && this.chatSession === s) { this.chatSession = null; if (!this.callSession) this.stopPolling(); } }, expiry - this.deps.now(), this.deadlines);
      this.startPolling();
    }
    return s;
  }

  private startPolling() {
    const gen = this.generation;
    if (this.pollTimer) return;
    const tick = async () => {
      await this.pollOnce();
      if (gen === this.generation && this.pollTimer !== null) this.pollTimer = this.deps.setTimeout(tick, 2000);
    };
    this.pollTimer = this.deps.setTimeout(tick, 1500);
  }
  private stopPolling() {
    if (this.pollTimer) this.deps.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
  async pollOnce() {
    const gen = this.generation;
    if (this.state.mode !== 'live' || this.state.replaying) return;
    for (const s of [this.chatSession, this.callSession]) {
      if (!s) continue;
      const r = await this.api("inbox.poll", "GET", `/sessions/${s.id}/messages?after=${encodeURIComponent(s.cursor)}`, s.phoneToken);
      if (gen !== this.generation) return;
      if (s !== this.chatSession && s !== this.callSession) continue;
      if (r.status === 410 || r.status === 401) {
        this.invalidateLive('session_unavailable');
        return;
      }
      const b = r.body as { messages?: { id: string; text: string | null; link: ChatLink | null; created_at: string }[]; next_cursor?: string; session?: { status: string } } | null;
      if (b?.session?.status === 'ended') { this.invalidateLive('session_ended'); return; }
      if (!r.ok || !b) continue;
      for (const m of b.messages ?? []) {
        this.push({ id: `app-${s.id}-${m.id}`, from: "them", kind: "message", text: m.text ?? "", link: m.link ?? undefined, at: Date.parse(m.created_at) || this.deps.now(), simulated: false });
      }
      if (b.next_cursor) s.cursor = b.next_cursor;
    }
    if (!this.chatSession && !this.callSession) this.stopPolling();
  }

  // ---------- recording / replay (local only) ----------
  startRecording() {
    this.recordStart = this.deps.now();
    this.set({ recording: [], isRecording: true });
  }
  stopRecording() { this.set({ isRecording: false }); }
  loadRecording(rec: RecordedEvent[]) { this.set({ recording: rec }); }

  /** Replays synthetic steps against the offline engine only. Never sends external calls. */
  replay(speed = 1) {
    if (this.state.replaying || this.state.recording.length === 0) return;
    const prevMode = this.state.mode;
    this.invalidateLive('replay');
    this.clearChatTimers();
    this.dispatchCall({ type: 'reset' });
    this.set({ replaying: true, isRecording: false, mode: "offline" });
    const steps = this.state.recording;
    for (const step of steps) {
      this.later(() => {
        if (step.type === "send") void this.sendMessage(step.text);
        else if (step.type === "scenario") this.runScenario(step.name);
        else if (step.action === "start") this.startCall();
        else if (step.action === "incoming") this.incomingCall();
        else if (step.action === "answer") this.answer();
        else if (step.action === "decline") this.decline();
        else void this.hangup();
      }, Math.min(step.t, 600000) / speed);
    }
    const end = Math.max(0, ...steps.map((s) => s.t)) / speed + 2500;
    this.later(() => this.set({ replaying: false, mode: prevMode }), end);
  }

  // ---------- teardown ----------
  private clearChatTimers() {
    for (const id of this.chatTimers) this.deps.clearTimeout(id);
    this.chatTimers.clear();
  }
  async dispose() {
    this.invalidateLive('disposed');
    this.clearChatTimers();
    this.stopPolling();
    await cleanupCall(this.res);
    this.chatSession = null;
    this.callSession = null;
    this.listeners.clear();
  }
  /** Exposed for tests. */
  get resources() { return this.res; }
  get activeTimerCount() { return this.chatTimers.size + this.res.timers.size; }
}
