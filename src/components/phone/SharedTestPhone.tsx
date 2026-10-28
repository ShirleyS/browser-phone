import { useEffect, useState } from "react";
import { Phone } from "@/components/phone/Phone";
import { usePhoneEngine } from "@/components/phone/usePhone";
import { shareClient, ShareRequestError, type ShareClient } from "@/lib/shares/client";
import type { ShareInfo } from "@/lib/shares/types";

const copy = {
  en: {
    title: "Test phone",
    loading: "Opening test phone…",
    missing: "Open the complete test link supplied by its owner in this tab.",
    unavailable: "This test link is unavailable or has expired. Ask the owner for a new link.",
    failed: "Could not load this test phone. Reload to try again.",
    remaining: (remaining: number, limit: number) => `${remaining} of ${limit} calls remaining`,
    expires: "Link expires",
    exhausted:
      "All call attempts have been used. Messages remain available until this link expires.",
    help: "Forwarded links share this allowance. Call attempts count even if the call later fails.",
  },
  es: {
    title: "Teléfono de prueba",
    loading: "Abriendo teléfono de prueba…",
    missing: "Abre en esta pestaña el enlace de prueba completo que te dio su propietario.",
    unavailable:
      "Este enlace de prueba no está disponible o ha vencido. Pide otro enlace a su propietario.",
    failed: "No se pudo cargar este teléfono. Recarga la página para volver a intentarlo.",
    remaining: (remaining: number, limit: number) =>
      `${remaining} de ${limit} llamadas disponibles`,
    expires: "El enlace vence",
    exhausted:
      "Se agotaron los intentos de llamada. Los mensajes siguen disponibles hasta que venza el enlace.",
    help: "Los enlaces reenviados comparten este límite. Los intentos cuentan aunque la llamada falle después.",
  },
};
const tokenPattern = /^bp_share_[A-Za-z0-9_-]{43}$/;
export function SharedTestPhone({
  id,
  client = shareClient,
}: {
  id: string;
  client?: ShareClient;
}) {
  const { engine, state } = usePhoneEngine({ isolated: true });
  const [loaded, setLoaded] = useState<{ id: string; info: ShareInfo } | null>(null);
  const [error, setError] = useState<"missing" | "unavailable" | "failed" | null>(null);
  const [blocked, setBlocked] = useState(false);
  const tr = copy[state.lang];
  useEffect(() => {
    let active = true,
      terminal = false,
      ready = false,
      poll: ReturnType<typeof setTimeout> | undefined,
      deadline: ReturnType<typeof setTimeout> | undefined;
    const storageKey = `browser-phone:share:${id}`;
    setLoaded(null);
    setError(null);
    setBlocked(false);
    engine.setConnection(null);
    engine.clearChat();
    engine.setAgentId("");
    engine.setMode("live");
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const hasFragmentKey = fragment.has("key");
    let capability = hasFragmentKey ? fragment.get("key") : null;
    if (url.hash) window.history.replaceState(window.history.state, "", url.pathname + url.search);
    try {
      if (!hasFragmentKey) capability = sessionStorage.getItem(storageKey);
    } catch {
      /* A valid fragment still works with unavailable storage. */
    }
    if (!capability || !tokenPattern.test(capability)) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage may be unavailable. */
      }
      setError("missing");
      setBlocked(true);
      return () => {
        active = false;
        engine.setConnection(null);
      };
    }
    const token = capability;
    try {
      sessionStorage.setItem(storageKey, token);
    } catch {
      /* Retain only in this component's memory. */
    }
    const unavailable = () => {
      if (!active || terminal) return;
      terminal = true;
      setBlocked(true);
      setError("unavailable");
      setLoaded(null);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage may be unavailable. */
      }
      engine.setConnection(null);
      if (poll) clearTimeout(poll);
      if (deadline) clearTimeout(deadline);
    };
    const refresh = async () => {
      if (!active || terminal) return;
      try {
        const info = await client.info(id, token);
        if (!active || terminal) return;
        const expires = Date.parse(info.expires_at);
        if (!Number.isFinite(expires) || expires <= Date.now()) {
          unavailable();
          return;
        }
        if (!ready) {
          engine.setContact(info.settings.contact);
          engine.setLang(info.settings.lang);
          engine.setAgentId("");
          engine.setConnection({
            apiBase: window.location.origin + "/api/public/v1",
            connectionId: "",
            webhookUrl: "",
            phoneToken: token,
            verified: true,
            shareId: id,
          });
          engine.setMode("live");
          ready = true;
        }
        setLoaded({ id, info });
        setError(null);
        if (deadline) clearTimeout(deadline);
        deadline = setTimeout(unavailable, Math.min(expires - Date.now(), 2147483647));
        poll = setTimeout(() => void refresh(), 15000);
      } catch (failure) {
        if (!active || terminal) return;
        if (failure instanceof ShareRequestError && [401, 403, 404, 410].includes(failure.status)) {
          unavailable();
          return;
        }
        setError("failed");
        poll = setTimeout(() => void refresh(), 15000);
      }
    };
    void refresh();
    return () => {
      active = false;
      if (poll) clearTimeout(poll);
      if (deadline) clearTimeout(deadline);
      engine.setConnection(null);
    };
  }, [id, client, engine]);
  const info = loaded?.id === id && !blocked ? loaded.info : null;
  // Both sources are snapshots of one allowance. A newer response can only reduce it.
  const usage =
    info?.usage && state.usage
      ? {
          ...info.usage,
          used: Math.max(info.usage.used, state.usage.used),
          remaining: Math.min(info.usage.remaining, state.usage.remaining),
        }
      : (state.usage ?? info?.usage);
  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground">
      <div className="mx-auto max-w-md space-y-4">
        <header className="space-y-2 text-center">
          <h1 className="font-display text-xl font-bold">{tr.title}</h1>
          {info && usage && (
            <>
              <p role="status" className="text-sm font-semibold">
                {tr.remaining(usage.remaining, usage.limit)}
              </p>
              <p className="text-xs text-muted-foreground">
                {tr.expires}: <time dateTime={info.expires_at}>{info.expires_at}</time>
              </p>
              <p className="text-xs text-muted-foreground">
                {usage.remaining === 0 ? tr.exhausted : tr.help}
              </p>
            </>
          )}
        </header>
        {error && (
          <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">
            {tr[error]}
          </p>
        )}
        {!info && !error && (
          <p role="status" className="text-center text-sm">
            {tr.loading}
          </p>
        )}
        {info && <Phone engine={engine} state={state} />}
      </div>
    </main>
  );
}
