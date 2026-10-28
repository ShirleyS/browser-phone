import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Phone } from "@/components/phone/Phone";
import { usePhoneEngine } from "@/components/phone/usePhone";
import { Workbench } from "@/components/workbench/Workbench";
import { outbound, parseEmbedParams, validateInbound, type EmbedParams } from "@/lib/phone/embed";
import { t } from "@/lib/phone/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Browser Phone — open-source testing phone for your app" },
      { name: "description", content: "A WhatsApp-style testing phone you connect to your own webhook. Offline demo, scenarios, inspector and bring-your-own ElevenLabs voice. No sign-up." },
      { property: "og:title", content: "Browser Phone — testing phone for developers" },
      { property: "og:description", content: "Test chat and voice flows against your own app from a phone in the browser. No sign-up." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { engine, state } = usePhoneEngine();
  const [embed, setEmbed] = useState<EmbedParams | null>(null);
  const tr = t(state.lang);

  useEffect(() => setEmbed(parseEmbedParams(window.location.search)), []);

  // postMessage bridge (embed mode only)
  useEffect(() => {
    if (!embed?.embed || !embed.parentOrigin || !embed.session || window.parent === window) return;
    const { parentOrigin, session } = embed;
    const send = (type: string, payload: Record<string, unknown> = {}) => window.parent.postMessage(outbound(session, type, payload), parentOrigin);
    engine.onOutbound = send;
    const onMsg = (ev: MessageEvent) => {
      const r = validateInbound(ev, { parentOrigin, session, parentWindow: window.parent });
      if (!r.ok) return;
      const c = r.cmd;
      if (c.type === "send_message") void engine.sendMessage(c.text);
      else if (c.type === "incoming_message") engine.receiveSimulated(c.text);
      else if (c.type === "incoming_call") engine.incomingCall();
      else if (c.type === "hangup") void engine.hangup();
      else send("pong");
    };
    window.addEventListener("message", onMsg);
    send("ready", { mode: state.mode });
    return () => {
      window.removeEventListener("message", onMsg);
      engine.onOutbound = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed, engine]);

  if (embed?.embed) {
    return (
      <main className="grid min-h-dvh place-items-center bg-transparent p-2">
        <Phone engine={engine} state={state} />
        {(!embed.parentOrigin || !embed.session) && <p className="mt-2 text-xs text-destructive">Embed needs parent_origin and session params — remote control disabled.</p>}
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-5 sm:px-6">
        <div className="grid size-9 place-items-center rounded-xl bg-phone-header font-display text-lg font-bold text-phone-header-foreground" aria-hidden>B</div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-none">{tr.appName}</h1>
          <p className="mt-1 truncate text-xs text-muted-foreground">{tr.tagline} MIT licensed.</p>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-full border bg-card p-1 text-xs" role="group" aria-label={tr.language}>
          {(["en", "es"] as const).map((l) => (
            <button key={l} aria-pressed={state.lang === l} onClick={() => engine.setLang(l)}
              className={`rounded-full px-3 py-1 font-semibold uppercase ${state.lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-8 px-4 pb-12 sm:px-6 lg:grid-cols-[400px_1fr]">
        <div className="lg:sticky lg:top-4 lg:self-start"><Phone engine={engine} state={state} /></div>
        <div className="min-w-0"><Workbench engine={engine} state={state} /></div>
      </main>
    </div>
  );
}
