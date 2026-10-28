// postMessage protocol for ?embed=1. Only the declared parent origin, the real parent
// window, and the matching session nonce are accepted.
export const PROTOCOL = "browser-phone";
export const PROTOCOL_VERSION = 1;

export type EmbedParams = { embed: boolean; parentOrigin: string | null; session: string | null };

export function normalizeOrigin(o: string | null): string | null {
  if (!o) return null;
  try {
    const u = new URL(o);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function parseEmbedParams(search: string): EmbedParams {
  const q = new URLSearchParams(search);
  const session = q.get("session");
  return {
    embed: q.get("embed") === "1",
    parentOrigin: normalizeOrigin(q.get("parent_origin")),
    session: session && /^[A-Za-z0-9_-]{8,64}$/.test(session) ? session : null,
  };
}

export type InboundCommand =
  | { type: "send_message"; text: string }
  | { type: "incoming_message"; text: string }
  | { type: "incoming_call" }
  | { type: "hangup" }
  | { type: "ping" };

export function validateInbound(
  ev: { origin: string; source: unknown; data: unknown },
  ctx: { parentOrigin: string | null; session: string | null; parentWindow: unknown },
): { ok: true; cmd: InboundCommand } | { ok: false; reason: string } {
  if (!ctx.parentOrigin || !ctx.session) return { ok: false, reason: "embed_not_configured" };
  if (ev.origin !== ctx.parentOrigin) return { ok: false, reason: "origin_mismatch" };
  if (ev.source !== ctx.parentWindow) return { ok: false, reason: "source_mismatch" };
  const d = ev.data as { protocol?: unknown; v?: unknown; session?: unknown; text?: unknown; type?: unknown } | null;
  if (!d || typeof d !== "object" || d.protocol !== PROTOCOL || d.v !== PROTOCOL_VERSION) return { ok: false, reason: "bad_envelope" };
  if (d.session !== ctx.session) return { ok: false, reason: "session_mismatch" };
  const text = typeof d.text === "string" ? d.text.slice(0, 4000) : "";
  switch (d.type) {
    case "send_message":
    case "incoming_message":
      return text ? { ok: true, cmd: { type: d.type, text } } : { ok: false, reason: "missing_text" };
    case "incoming_call":
    case "hangup":
    case "ping":
      return { ok: true, cmd: { type: d.type } };
    default:
      return { ok: false, reason: "unknown_type" };
  }
}

export function outbound(session: string, type: string, payload: Record<string, unknown> = {}) {
  return { protocol: PROTOCOL, v: PROTOCOL_VERSION, session, type, ...payload };
}

export function newSessionNonce() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function iframeSnippet(appOrigin: string, parentOrigin: string, session: string) {
  const src = `${appOrigin}/?embed=1&parent_origin=${encodeURIComponent(parentOrigin)}&session=${session}`;
  return `<iframe src="${src}" title="Browser Phone" width="380" height="760" allow="microphone" style="border:0;border-radius:32px"></iframe>
<script>
  const phone = document.querySelector('iframe[title="Browser Phone"]').contentWindow;
  const PHONE_ORIGIN = "${appOrigin}";
  const SESSION = "${session}";
  window.addEventListener("message", (e) => {
    if (e.origin !== PHONE_ORIGIN || e.data?.session !== SESSION) return;
    console.log("phone event", e.data);
  });
  // phone.postMessage({ protocol: "browser-phone", v: 1, session: SESSION, type: "incoming_message", text: "Hi!" }, PHONE_ORIGIN);
</script>`;
}
