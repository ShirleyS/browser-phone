import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { PhoneEngine, PhoneState } from "@/lib/phone/engine";
import { t } from "@/lib/phone/i18n";
import { buildExport, parseImport } from "@/lib/phone/transfer";
import { iframeSnippet, newSessionNonce, normalizeOrigin } from "@/lib/phone/embed";
import type { ScenarioName } from "@/lib/phone/types";
import { Docs } from "./Docs";
import { cn } from "@/lib/utils";

type P = { engine: PhoneEngine; state: PhoneState };

export function Workbench({ engine, state }: P) {
  const tr = t(state.lang);
  return (
    <Tabs defaultValue="connect" className="flex h-full flex-col">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="connect">{tr.tabs.connect}</TabsTrigger>
        <TabsTrigger value="scenarios">{tr.tabs.scenarios}</TabsTrigger>
        <TabsTrigger value="inspector">{tr.tabs.inspector}{state.inspector.length ? ` (${state.inspector.length})` : ""}</TabsTrigger>
        <TabsTrigger value="docs">{tr.tabs.docs}</TabsTrigger>
      </TabsList>
      <TabsContent value="connect" className="mt-4 space-y-5"><Connect engine={engine} state={state} /></TabsContent>
      <TabsContent value="scenarios" className="mt-4 space-y-5"><Scenarios engine={engine} state={state} /></TabsContent>
      <TabsContent value="inspector" className="mt-4"><Inspector state={state} /></TabsContent>
      <TabsContent value="docs" className="mt-4"><Docs /></TabsContent>
    </Tabs>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

function Copy({ value, label }: { value: string; label: string }) {
  return <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(value); toast.success(label); }}>{label}</Button>;
}

function Connect({ engine, state }: P) {
  const tr = t(state.lang);
  const [hook, setHook] = useState(state.connection?.webhookUrl ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pairNote, setPairNote] = useState<string | null>(null);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [capabilityChecked, setCapabilityChecked] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/public/v1/connections', { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(data => { if (!controller.signal.aborted) { setLiveEnabled(data?.enabled === true); setCapabilityChecked(true); } }).catch(() => { if (!controller.signal.aborted) setCapabilityChecked(true); });
    return () => controller.abort();
  }, []);
  const c = state.connection;

  const register = async () => {
    setBusy(true); setErr(null); setPairNote(null);
    const r = await engine.registerWebhook(`${window.location.origin}/api/public/v1`, hook.trim());
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setPairNote(r.pairing?.delivered ? "Pairing code delivered to your webhook." : `Pairing code could NOT be delivered (${r.pairing?.error ?? "unknown"}). Fix your webhook and register again.`);
  };
  const verify = async () => {
    setBusy(true); setErr(null);
    const r = await engine.verify(code.trim());
    setBusy(false);
    if (!r.ok) setErr(r.error ?? "failed");
  };

  return (
    <>
      <Section title={tr.modeTitle}>
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {(["offline", "live"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={state.mode === m} onClick={() => engine.setMode(m)}
              className={cn("rounded-lg border p-3 text-left text-sm transition", state.mode === m ? "border-primary bg-secondary" : "hover:bg-muted")}>
              <div className="font-semibold">{m === "offline" ? tr.offlineDemo : tr.liveMode}</div>
              <div className="mt-1 text-xs text-muted-foreground">{m === "offline" ? tr.offlineDesc : tr.liveDesc}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{tr.costs}</p>
      </Section>

      {state.mode === "live" && (
        <Section title="Webhook" aside={c?.verified ? <Badge className="bg-success text-primary-foreground">{tr.verified}</Badge> : c?.connectionId ? <Badge variant="outline">{tr.pending}</Badge> : <Badge variant="outline">Not connected</Badge>}>
          {!liveEnabled && <p role="status" className="mb-3 text-sm text-destructive">{capabilityChecked ? 'Webhook messages and webhook-backed calls are disabled on this deployment. Public-only outbound networking is not verified. Use the pinned Node self-host startup documented in the source; public-agent voice connects directly to ElevenLabs.' : 'Checking whether this deployment supports safe webhook delivery…'}</p>}
          {!c?.connectionId ? (
            <div className="space-y-2">
              <Label htmlFor="hook">{tr.webhookUrl}</Label>
              <div className="flex gap-2">
                <Input id="hook" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://your-app.example.com/browser-phone" />
                <Button onClick={register} disabled={!liveEnabled || busy || !hook.startsWith("https://")}>{tr.register}</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="break-all font-mono text-xs text-muted-foreground">{c.webhookUrl}</div>
              {c.signingSecret && (
                <div className="rounded-lg border border-warning bg-warning/20 p-3">
                  <div className="mb-1 text-xs font-semibold">{tr.signingSecret}</div>
                  <div className="flex items-center gap-2"><code className="flex-1 break-all text-xs">{c.signingSecret}</code><Copy value={c.signingSecret} label={tr.copy} /></div>
                </div>
              )}
              {!c.verified && (
                <div className="space-y-2">
                  <Label htmlFor="code">{tr.pairingCode}</Label>
                  <p className="text-xs text-muted-foreground">{tr.pairingHelp}</p>
                  <div className="flex gap-2">
                    <Input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} className="font-mono tracking-widest" />
                    <Button onClick={verify} disabled={busy || code.length < 4}>{tr.verify}</Button>
                  </div>
                </div>
              )}
              {c.verified && state.usage && (
                <div className="rounded-lg bg-muted p-3">
                  <div className="text-xs text-muted-foreground">{tr.allowance}</div>
                  <div className="font-display text-2xl font-semibold">{state.usage.remaining} <span className="text-sm font-normal text-muted-foreground">/ {state.usage.limit} {tr.sessionsLeft}</span></div>
                  <div className="text-xs text-muted-foreground">{tr.resets} {new Date(state.usage.reset_at).toUTCString()}</div>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={() => { void engine.revoke(); setCode(""); setPairNote(null); }}>{tr.disconnect}</Button>
            </div>
          )}
          {pairNote && <p className="mt-2 text-xs" role="status">{pairNote}</p>}
          {err && <p className="mt-2 text-xs text-destructive" role="alert">{err}</p>}
        </Section>
      )}

      {state.mode === "live" && (
        <Section title={tr.voice}>
          <Label htmlFor="agent">{tr.agentId}</Label>
          <Input id="agent" className="mt-1.5 font-mono" value={state.agentId} onChange={(e) => engine.setAgentId(e.target.value)} placeholder="agent_…" />
          <p className="mt-2 text-xs text-muted-foreground">{tr.voiceHelp}</p>
        </Section>
      )}

      <Section title={tr.contact}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="cn">{tr.contactName}</Label><Input id="cn" className="mt-1.5" value={state.contact.name} onChange={(e) => engine.setContact({ ...state.contact, name: e.target.value })} /></div>
          <div><Label htmlFor="cnum">{tr.displayNumber}</Label><Input id="cnum" className="mt-1.5" value={state.contact.number} onChange={(e) => engine.setContact({ ...state.contact, number: e.target.value })} /></div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{tr.fakeNumber}</p>
      </Section>

      <EmbedSection state={state} />
    </>
  );
}

export function EmbedSection({ state }: { state: Pick<PhoneState, "lang"> }) {
  const tr = t(state.lang);
  const [parent, setParent] = useState("https://your-app.example.com");
  // Browser origin and random session are created after mount so SSR and the
  // first client render produce identical markup.
  const [client, setClient] = useState<{ origin: string; nonce: string } | null>(null);
  useEffect(() => setClient({ origin: window.location.origin, nonce: newSessionNonce() }), []);
  const valid = normalizeOrigin(parent);
  const snippet = useMemo(() => (valid && client ? iframeSnippet(client.origin, valid, client.nonce) : ""), [client, valid]);
  return (
    <Section title={tr.embed}>
      <p className="mb-2 text-xs text-muted-foreground">{tr.embedHelp}</p>
      <Label htmlFor="po">{tr.parentOrigin}</Label>
      <Input id="po" className="mt-1.5 font-mono" value={parent} onChange={(e) => setParent(e.target.value)} />
      {valid && !snippet ? <p className="mt-3 text-xs text-muted-foreground">…</p> : valid ? (
        <>
          <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-phone-frame p-3 text-[11px] text-call-foreground">{snippet}</pre>
          <div className="mt-2"><Copy value={snippet} label={tr.copy} /></div>
        </>
      ) : <p className="mt-2 text-xs text-destructive">Enter an https origin (or http://localhost).</p>}
    </Section>
  );
}

const SCENARIOS: ScenarioName[] = ["incoming_call", "incoming_message", "delayed_reply", "disconnect", "failed_delivery", "receipt_link", "payment_link"];

function Scenarios({ engine, state }: P) {
  const tr = t(state.lang);
  const fileRef = useRef<HTMLInputElement>(null);
  const download = () => {
    const b = buildExport({ contact: state.contact, lang: state.lang, webhookUrl: state.connection?.webhookUrl, connectionId: state.connection?.connectionId, agentId: state.agentId || undefined, chat: state.chat, recording: state.recording });
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `browser-phone-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseImport(await f.text());
    if (!r.ok) return toast.error(r.error);
    engine.setLang(r.bundle.config.lang);
    engine.setContact(r.bundle.config.contact);
    engine.clearChat();
    for (const m of r.bundle.conversation) engine.receiveImported(m);
    engine.loadRecording(r.bundle.recording);
    return toast.success(`Imported ${r.bundle.conversation.length} messages, ${r.bundle.recording.length} steps`);
  };
  return (
    <>
      <Section title={tr.tabs.scenarios}>
        <p className="mb-3 text-xs text-muted-foreground">{tr.scenariosHelp}</p>
        <div className="grid grid-cols-2 gap-2">
          {SCENARIOS.map((s) => (
            <Button key={s} variant={s === "disconnect" && state.netDown ? "default" : "outline"} className="justify-start" onClick={() => engine.runScenario(s)}>
              {tr.scenario[s]}{s === "disconnect" && state.netDown ? " ✓" : ""}
            </Button>
          ))}
        </div>
      </Section>
      <Section title={`${tr.record} / ${tr.replay}`} aside={<span className="text-xs text-muted-foreground">{state.recording.length} {tr.recorded}</span>}>
        <div className="flex flex-wrap gap-2">
          {state.isRecording ? <Button variant="destructive" onClick={() => engine.stopRecording()}>{tr.stopRecording}</Button> : <Button variant="outline" onClick={() => engine.startRecording()}>● {tr.record}</Button>}
          <Button variant="outline" disabled={!state.recording.length || state.replaying || state.isRecording} onClick={() => { engine.clearChat(); engine.replay(); }}>{state.replaying ? "…" : tr.replay}</Button>
          <Button variant="ghost" onClick={() => engine.clearChat()}>{tr.clear}</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Replay runs in the offline engine: no webhook, provider or network calls.</p>
      </Section>
      <Section title={`${tr.exportJson} / ${tr.importJson}`}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={download}>{tr.exportJson}</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>{tr.importJson}</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Tokens, signing secrets, signed URLs and webhook query strings are removed from every download.</p>
      </Section>
    </>
  );
}

function Inspector({ state }: { state: PhoneState }) {
  const tr = t(state.lang);
  if (!state.inspector.length) return <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">{tr.inspectorEmpty}</p>;
  return (
    <ol className="space-y-2">
      {state.inspector.map((e) => {
        const delivery = (e.response as { delivery?: { ok: boolean; status: number | null; latency_ms: number; error: string | null } } | null)?.delivery;
        return (
          <li key={e.id}>
            <details className="rounded-xl border bg-card">
              <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm">
                <span className={cn("size-2 shrink-0 rounded-full", e.ok ? "bg-success" : "bg-destructive")} aria-label={e.ok ? "ok" : "error"} />
                <span className="font-mono text-xs">{e.method}</span>
                <span className="font-medium">{e.label}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{e.status ?? "ERR"} · {e.latencyMs}ms</span>
              </summary>
              <div className="space-y-2 border-t p-3 text-xs">
                <div className="break-all font-mono text-muted-foreground">{e.url}</div>
                {e.error && <div className="text-destructive">error: {e.error}</div>}
                {delivery && (
                  <div className={cn("rounded-md p-2", delivery.ok ? "bg-secondary" : "bg-destructive/10 text-destructive")}>
                    Webhook delivery: {delivery.ok ? "OK" : "FAILED"} · status {delivery.status ?? "none"} · {delivery.latency_ms}ms{delivery.error ? ` · ${delivery.error}` : ""}
                  </div>
                )}
                <div className="font-semibold">Request (redacted)</div>
                <pre className="max-h-48 overflow-auto rounded bg-muted p-2">{JSON.stringify(e.request, null, 2)}</pre>
                <div className="font-semibold">Response (redacted)</div>
                <pre className="max-h-64 overflow-auto rounded bg-muted p-2">{JSON.stringify(e.response, null, 2)}</pre>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
