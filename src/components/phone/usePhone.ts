import { useEffect, useState, useSyncExternalStore } from "react";
import { PhoneEngine } from "@/lib/phone/engine";
import { startVoice } from "@/lib/voice/adapter";
import type { LiveConnection } from "@/lib/phone/types";

const PREFS_KEY = "browser-phone:prefs"; // non-secret preferences only
const CONN_KEY = "browser-phone:connection"; // per-tab, sessionStorage

function createEngine() {
  return new PhoneEngine({
    fetch: (...a) => fetch(...a),
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    startVoice,
    uuid: () => crypto.randomUUID(),
  });
}

export function usePhoneEngine({ isolated = false }: { isolated?: boolean } = {}) {
  const [engine] = useState(createEngine);
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  // hydrate prefs after mount (avoid SSR mismatch)
  useEffect(() => {
    if (isolated) return () => void engine.dispose();
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p?.lang) engine.setLang(p.lang === "es" ? "es" : "en");
      if (p?.contact?.name) engine.setContact(p.contact);
      if (p?.agentId) engine.setAgentId(p.agentId);
      const c = JSON.parse(sessionStorage.getItem(CONN_KEY) || "null") as LiveConnection | null;
      if (c?.connectionId && c.phoneToken) {
        engine.setConnection(c);
        engine.setMode("live");
        void engine.refreshUsage();
      }
    } catch {
      /* ignore corrupt prefs */
    }
    return () => void engine.dispose();
  }, [engine, isolated]);

  useEffect(() => {
    if (isolated) return;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ lang: state.lang, contact: state.contact, agentId: state.agentId }));
  }, [isolated, state.lang, state.contact, state.agentId]);

  useEffect(() => {
    if (isolated) return;
    if (state.connection?.connectionId) {
      // signing secret is intentionally not persisted
      const { signingSecret: _s, ...rest } = state.connection;
      sessionStorage.setItem(CONN_KEY, JSON.stringify(rest));
    } else sessionStorage.removeItem(CONN_KEY);
  }, [isolated, state.connection]);

  return { engine, state };
}
