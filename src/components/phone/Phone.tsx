import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCheck, Clock, ExternalLink, Mic, MicOff, Phone as PhoneIcon, PhoneOff, Send, Volume2, AlertCircle, AudioLines, WifiOff } from "lucide-react";
import type { PhoneEngine, PhoneState } from "@/lib/phone/engine";
import { t } from "@/lib/phone/i18n";
import { formatDuration } from "@/lib/phone/demo";
import type { ChatItem } from "@/lib/phone/types";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Phone({ engine, state }: { engine: PhoneEngine; state: PhoneState }) {
  const tr = t(state.lang);
  return (
    <div className="phone-shell relative mx-auto flex h-[760px] max-h-[calc(100dvh-2rem)] w-full max-w-[380px] flex-col overflow-hidden rounded-[2.75rem] p-3">
      <div className="relative flex h-full flex-col overflow-hidden rounded-[2.1rem] bg-phone-wallpaper">
        <StatusBar mode={state.mode} netDown={state.netDown} tr={tr} />
        {state.view === "call" && state.call.status !== "idle" ? <CallScreen engine={engine} state={state} /> : <ChatScreen engine={engine} state={state} />}
      </div>
    </div>
  );
}

function StatusBar({ mode, netDown, tr }: { mode: string; netDown: boolean; tr: ReturnType<typeof t> }) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const f = () => setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    f();
    const id = setInterval(f, 20000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center justify-between bg-phone-header px-6 pb-1 pt-3 text-[11px] font-medium text-phone-header-foreground">
      <span suppressHydrationWarning>{now}</span>
      <span className="flex items-center gap-1.5">
        {netDown && <WifiOff className="size-3" aria-label={tr.disconnected} />}
        <span className="rounded-full bg-call-control px-2 py-0.5 uppercase tracking-wide">{mode === "offline" ? tr.offlineDemo : tr.liveMode}</span>
      </span>
    </div>
  );
}

function ChatScreen({ engine, state }: { engine: PhoneEngine; state: PhoneState }) {
  const tr = t(state.lang);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [state.chat.length, state.typing]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void engine.sendMessage(text);
    setText("");
  };
  const callActive = state.call.status !== "idle" && state.call.status !== "ended";
  return (
    <>
      <header className="flex items-center gap-3 bg-phone-header px-3 pb-3 pt-1 text-phone-header-foreground">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent font-display text-sm font-bold text-accent-foreground" aria-hidden>
          {initials(state.contact.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-tight">{state.contact.name}</div>
          <div className="truncate text-xs opacity-80">{state.typing ? tr.typing : state.contact.number}</div>
        </div>
        {callActive ? (
          <button className="rounded-full bg-call-accept px-3 py-1.5 text-xs font-semibold text-call-foreground" onClick={() => engine.setView("call")}>
            {formatDuration(state.call.startedAt ? Date.now() - state.call.startedAt : 0)}
          </button>
        ) : (
          <button aria-label={tr.call} className="grid size-10 place-items-center rounded-full hover:bg-call-control focus-visible:outline-2 focus-visible:outline-phone-header-foreground" onClick={() => engine.startCall()}>
            <PhoneIcon className="size-5" />
          </button>
        )}
      </header>
      {state.banner && <div role="alert" className="bg-warning px-3 py-1.5 text-xs text-warning-foreground">{state.banner}</div>}
      <div ref={listRef} className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3" aria-live="polite" aria-label="Conversation">
        {state.chat.length === 0 && (
          <div className="mx-auto mt-6 max-w-[85%] rounded-lg bg-bubble-in/80 px-3 py-2 text-center text-xs text-bubble-meta">
            {state.mode === "offline" ? tr.offlineDesc : tr.liveDesc}
          </div>
        )}
        {state.chat.map((m) => <Bubble key={m.id} m={m} tr={tr} onRetry={() => void engine.sendMessage(m.text, m.id)} />)}
        {state.typing && (
          <div className="w-fit rounded-lg rounded-tl-none bg-bubble-in px-3 py-2 text-bubble-meta"><span className="animate-pulse">•••</span></div>
        )}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 px-2 pb-4 pt-1">
        <label className="sr-only" htmlFor="phone-input">{tr.messagePlaceholder}</label>
        <input id="phone-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder={tr.messagePlaceholder}
          className="h-11 min-w-0 flex-1 rounded-full bg-bubble-in px-4 text-sm text-bubble-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <button type="submit" aria-label={tr.send} className="grid size-11 shrink-0 place-items-center rounded-full bg-phone-header text-phone-header-foreground shadow-sm disabled:opacity-50" disabled={!text.trim()}>
          <Send className="size-5" />
        </button>
      </form>
    </>
  );
}

function Ticks({ s }: { s: ChatItem["status"] }) {
  if (s === "sending") return <Clock className="size-3.5" aria-label="sending" />;
  if (s === "sent") return <Check className="size-3.5" aria-label="sent" />;
  if (s === "delivered") return <CheckCheck className="size-3.5" aria-label="delivered" />;
  if (s === "read") return <CheckCheck className="size-3.5 text-tick-read" aria-label="read" />;
  if (s === "failed") return <AlertCircle className="size-3.5 text-destructive" aria-label="failed" />;
  return null;
}

function Bubble({ m, tr, onRetry }: { m: ChatItem; tr: ReturnType<typeof t>; onRetry: () => void }) {
  if (m.kind === "system")
    return <div className="mx-auto my-2 w-fit max-w-[90%] rounded-md bg-secondary px-2.5 py-1 text-center text-[11px] text-secondary-foreground">{m.text}</div>;
  const mine = m.from === "me";
  return (
    <div className={cn("flex animate-bubble", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[82%] rounded-lg px-2.5 pb-1 pt-1.5 text-sm text-bubble-foreground shadow-sm", mine ? "rounded-tr-none bg-bubble-out" : "rounded-tl-none bg-bubble-in", m.kind === "transcript" && "border border-dashed border-bubble-meta/50")}>
        {m.kind === "transcript" && (
          <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-bubble-meta"><AudioLines className="size-3" />{tr.transcript}</div>
        )}
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
        {m.link && (
          <a href={m.link.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1.5 flex items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs font-semibold text-primary underline-offset-2 hover:underline">
            <ExternalLink className="size-3.5" />{m.link.label}
            {m.link.simulated && <span className="ml-auto rounded bg-warning px-1 text-[9px] uppercase text-warning-foreground">{tr.simulated}</span>}
          </a>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-bubble-meta">
          {m.simulated && !mine && m.kind === "message" && <span className="mr-auto rounded bg-muted px-1 uppercase">{tr.demoReply}</span>}
          <time>{time(m.at)}</time>
          {mine && m.kind === "message" && <Ticks s={m.status} />}
        </div>
        {m.status === "failed" && (
          <button onClick={onRetry} className="mt-0.5 block w-full text-right text-[11px] font-medium text-destructive underline">
            {tr.failedRetry}{m.error ? ` (${m.error})` : ""}
          </button>
        )}
      </div>
    </div>
  );
}

function CallScreen({ engine, state }: { engine: PhoneEngine; state: PhoneState }) {
  const tr = t(state.lang);
  const c = state.call;
  const [, force] = useState(0);
  useEffect(() => {
    if (c.status !== "active") return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [c.status]);
  const label =
    c.status === "incoming" ? tr.callIncoming : c.status === "outgoing" ? tr.callOutgoing : c.status === "connecting" ? tr.callConnecting
      : c.status === "ended" ? `${tr.callEnded}${c.endReason && c.endReason !== "hangup" ? ` · ${c.endReason}` : ""}` : formatDuration(c.startedAt ? Date.now() - c.startedAt : 0);
  const ringing = c.status === "incoming" || c.status === "outgoing";
  return (
    <div className="call-surface flex flex-1 flex-col items-center px-6 pb-10 pt-6 text-call-foreground">
      <button onClick={() => engine.setView("chat")} className="flex items-center gap-1 self-start text-xs opacity-80 hover:opacity-100"><ArrowLeft className="size-4" />{tr.back}</button>
      <div className="relative mt-12">
        {ringing && <span className="absolute inset-0 animate-ring rounded-full bg-call-accept" aria-hidden />}
        <div className="relative grid size-28 place-items-center rounded-full bg-accent font-display text-4xl font-bold text-accent-foreground">{initials(state.contact.name)}</div>
      </div>
      <h2 className="mt-6 text-2xl font-semibold">{state.contact.name}</h2>
      <p className="text-sm opacity-80">{state.contact.number}</p>
      <p className="mt-3 font-mono text-lg tabular-nums" aria-live="polite">{label}</p>
      <p className="mt-2 rounded-full bg-call-control px-3 py-1 text-center text-[11px]">{c.note ?? (c.live ? tr.liveCall : tr.simulatedCall)}</p>
      <div className="mt-auto w-full">
        {c.status === "incoming" ? (
          <div className="flex justify-around">
            <RoundBtn label={tr.decline} tone="decline" onClick={() => engine.decline()}><PhoneOff className="size-7" /></RoundBtn>
            <RoundBtn label={tr.answer} tone="accept" onClick={() => engine.answer()}><PhoneIcon className="size-7" /></RoundBtn>
          </div>
        ) : c.status === "ended" ? null : (
          <div className="space-y-6">
            <div className="flex justify-center gap-8">
              <RoundBtn label={c.muted ? tr.unmute : tr.mute} pressed={c.muted} disabled={c.status !== "active"} onClick={() => engine.toggleMute()}>{c.muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}</RoundBtn>
              <RoundBtn label={tr.speaker} pressed={c.speaker} disabled={c.status !== "active"} onClick={() => engine.toggleSpeaker()}><Volume2 className="size-6" /></RoundBtn>
            </div>
            <div className="flex justify-center"><RoundBtn label={tr.hangup} tone="decline" onClick={() => void engine.hangup()}><PhoneOff className="size-7" /></RoundBtn></div>
          </div>
        )}
      </div>
    </div>
  );
}

function RoundBtn({ label, onClick, children, tone, pressed, disabled }: { label: string; onClick: () => void; children: React.ReactNode; tone?: "accept" | "decline"; pressed?: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}
        className={cn("grid size-16 place-items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-call-foreground disabled:opacity-40",
          tone === "accept" ? "bg-call-accept" : tone === "decline" ? "bg-call-decline" : pressed ? "bg-call-foreground text-phone-header" : "bg-call-control")}>
        {children}
      </button>
      <span className="text-[11px] opacity-90">{label}</span>
    </div>
  );
}
