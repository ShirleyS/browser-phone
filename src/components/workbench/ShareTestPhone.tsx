import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PhoneState } from "@/lib/phone/engine";
import { isLocalShareOwner, shareClient, type ShareClient } from "@/lib/shares/client";
import type { ShareSummary } from "@/lib/shares/types";

const copy = {
  en: {
    title: "Share a test phone",
    help: "Forwarded links share one call allowance. Call attempts count, including calls that fail after starting. Messages remain available until the link expires. The existing daily session limit (20 per webhook by default) still applies to chats and calls.",
    pair: "Connect and verify your webhook on this deployment before creating a test link.",
    allowance: "Call allowance",
    custom: "Custom",
    customLabel: "Custom call allowance",
    expiry: "Link expires after",
    hour: "1 hour",
    day: "24 hours",
    week: "7 days",
    create: "Create test link",
    copy: "Copy test link",
    copied: "Test link copied.",
    revoke: "Revoke",
    revoked: "Revoked",
    empty: "No shared links yet.",
    lost: "The full link is shown only when created. Create a new link if you lose it or reload this page.",
    used: "calls used",
    expires: "Expires",
    loading: "Working…",
    failure: "This action did not complete. Please try again.",
    clipboard: "Copy the test link from the field above.",
    expiryHelp: "The link also ends when the connected webhook expires.",
  },
  es: {
    title: "Compartir un teléfono de prueba",
    help: "Los enlaces reenviados comparten un límite de llamadas. Los intentos cuentan, incluso las llamadas que fallan después de iniciarse. Los mensajes siguen disponibles hasta que venza el enlace. También se mantiene el límite diario de sesiones (20 por webhook de forma predeterminada), incluidos chats y llamadas.",
    pair: "Conecta y verifica tu webhook en esta plataforma antes de crear un enlace de prueba.",
    allowance: "Límite de llamadas",
    custom: "Personalizado",
    customLabel: "Límite personalizado de llamadas",
    expiry: "El enlace vence después de",
    hour: "1 hora",
    day: "24 horas",
    week: "7 días",
    create: "Crear enlace de prueba",
    copy: "Copiar enlace de prueba",
    copied: "Enlace de prueba copiado.",
    revoke: "Revocar",
    revoked: "Revocado",
    empty: "Aún no hay enlaces compartidos.",
    lost: "El enlace completo solo aparece al crearlo. Crea otro enlace si lo pierdes o recargas esta página.",
    used: "llamadas usadas",
    expires: "Vence",
    loading: "Procesando…",
    failure: "No se completó esta acción. Inténtalo de nuevo.",
    clipboard: "Copia el enlace de prueba del campo anterior.",
    expiryHelp: "El enlace también vence cuando caduca la conexión del webhook.",
  },
};
type State = Pick<PhoneState, "contact" | "lang" | "connection">;
export function ShareTestPhone({
  state,
  client = shareClient,
}: {
  state: State;
  client?: ShareClient;
}) {
  const tr = copy[state.lang],
    connection = state.connection;
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<ShareSummary[]>([]);
  const [allowance, setAllowance] = useState("3"),
    [custom, setCustom] = useState("3"),
    [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [note, setNote] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const generation = useRef(0);
  const invalidatePending = useCallback(() => {
    generation.current++;
  }, []);
  const eligible =
    !!connection?.verified &&
    !!connection.webhookUrl &&
    !connection.shareId &&
    isLocalShareOwner(connection);
  const limit = allowance === "custom" ? Number(custom) : Number(allowance);
  const validLimit = Number.isInteger(limit) && limit >= 1 && limit <= 100;
  useEffect(() => {
    const current = ++generation.current;
    setRows([]);
    setFresh(null);
    setError(null);
    setNote(null);
    setBusy(false);
    if (open && eligible && connection) {
      setBusy(true);
      void client
        .list(connection)
        .then((entries) => {
          if (generation.current === current) setRows(entries);
        })
        .catch(() => {
          if (generation.current === current) setError(tr.failure);
        })
        .finally(() => {
          if (generation.current === current) setBusy(false);
        });
    }
    return invalidatePending;
  }, [open, eligible, connection, client, tr.failure, invalidatePending]);
  const create = async () => {
    if (!eligible || !connection || !validLimit || busy) return;
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    setFresh(null);
    setNote(null);
    try {
      const result = await client.create(connection, {
        settings: { contact: state.contact, lang: state.lang },
        call_limit: limit,
        expires_in_hours: Number(hours),
      });
      if (generation.current !== current) return;
      setRows((entries) => [
        result.share,
        ...entries.filter((entry) => entry.id !== result.share.id),
      ]);
      if (!/^bp_share_[A-Za-z0-9_-]{43}$/.test(result.token))
        throw new Error("Invalid share token");
      setFresh({
        id: result.share.id,
        url: `${window.location.origin}/test/${encodeURIComponent(result.share.id)}#key=${result.token}`,
      });
    } catch {
      if (generation.current === current) setError(tr.failure);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    if (!connection || !eligible || busy) return;
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await client.revoke(connection, id);
      if (generation.current !== current) return;
      setRows((entries) =>
        entries.map((entry) =>
          entry.id === id ? { ...entry, revoked_at: new Date().toISOString() } : entry,
        ),
      );
      setFresh((value) => (value?.id === id ? null : value));
    } catch {
      if (generation.current === current) setError(tr.failure);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  };
  const copyLink = async () => {
    if (!fresh) return;
    const current = generation.current;
    try {
      await navigator.clipboard.writeText(fresh.url);
      if (current === generation.current) setNote(tr.copied);
    } catch {
      if (current === generation.current) setNote(tr.clipboard);
    }
  };
  return (
    <section className="rounded-xl border bg-card p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-sm font-semibold"
        aria-expanded={open}
        aria-controls="share-phone-content"
        onClick={() => setOpen((value) => !value)}
      >
        {tr.title}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div id="share-phone-content" className="mt-3 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">{tr.help}</p>
          {!eligible && <p className="text-xs">{tr.pair}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="share-allowance">{tr.allowance}</Label>
              <select
                id="share-allowance"
                className="mt-1 h-10 w-full rounded-md border bg-background px-2"
                value={allowance}
                onChange={(event) => setAllowance(event.target.value)}
                disabled={busy}
              >
                {[1, 3, 5].map((value) => (
                  <option key={value} value={value}>
                    {state.lang === "es"
                      ? `${value} ${value === 1 ? "llamada" : "llamadas"}`
                      : `${value} ${value === 1 ? "call" : "calls"}`}
                  </option>
                ))}
                <option value="custom">{tr.custom}</option>
              </select>
            </div>
            <div>
              <Label htmlFor="share-expiry">{tr.expiry}</Label>
              <select
                id="share-expiry"
                className="mt-1 h-10 w-full rounded-md border bg-background px-2"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                disabled={busy}
              >
                <option value="1">{tr.hour}</option>
                <option value="24">{tr.day}</option>
                <option value="168">{tr.week}</option>
              </select>
            </div>
          </div>
          {allowance === "custom" && (
            <div>
              <Label htmlFor="share-custom">{tr.customLabel}</Label>
              <Input
                id="share-custom"
                type="number"
                min={1}
                max={100}
                step={1}
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                disabled={busy}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{tr.expiryHelp}</p>
          <Button onClick={() => void create()} disabled={!eligible || !validLimit || busy}>
            {tr.create}
          </Button>
          {busy && (
            <p role="status" className="text-xs">
              {tr.loading}
            </p>
          )}
          {eligible && fresh && (
            <div className="space-y-2">
              <Input
                aria-label={state.lang === "es" ? "Enlace de prueba" : "Test link"}
                readOnly
                value={fresh.url}
              />
              <Button variant="outline" onClick={() => void copyLink()}>
                {tr.copy}
              </Button>
            </div>
          )}
          {eligible && (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.id} className="space-y-1 rounded-lg border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-all">{row.id}</span>
                    {row.revoked_at ? (
                      <span>{tr.revoked}</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${tr.revoke} ${row.id}`}
                        disabled={busy}
                        onClick={() => void revoke(row.id)}
                      >
                        {tr.revoke}
                      </Button>
                    )}
                  </div>
                  <p>
                    {row.calls_used}/{row.call_limit} {tr.used} · {tr.expires}:{" "}
                    <time dateTime={row.expires_at}>{row.expires_at}</time>
                  </p>
                </li>
              ))}
            </ul>
          )}
          {eligible && !busy && !rows.length && (
            <p className="text-xs text-muted-foreground">{tr.empty}</p>
          )}
          <p className="text-xs text-muted-foreground">{tr.lost}</p>
          {note && (
            <p role="status" className="text-xs">
              {note}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
