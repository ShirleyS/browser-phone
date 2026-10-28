import { describe, expect, it } from "vitest";
import { buildExport, parseImport } from "@/lib/phone/transfer";
import { validateInbound, parseEmbedParams } from "@/lib/phone/embed";

describe("export redaction", () => {
  it("never includes tokens, secrets, signed URLs or webhook query strings", () => {
    const b = buildExport({
      contact: { name: "Ring Orden", number: "+52 55 91100000" }, lang: "en",
      webhookUrl: "https://hooks.example.com/x?token=supersecret123",
      connectionId: "c1",
      chat: [{ id: "1", from: "them", kind: "message", text: "use Bearer abcdefghijklmnop and bp_cb_AAAAAAAAAAAAAAAA and wss://api.elevenlabs.io/x?token=zzz", at: 1, simulated: true }],
      recording: [{ t: 0, type: "send", text: "hi whsec_ABCDEFGHIJKL" }],
    });
    const s = JSON.stringify(b);
    for (const bad of ["supersecret123", "abcdefghijklmnop", "bp_cb_AAAA", "token=zzz", "whsec_ABCDEFGHIJKL"]) expect(s).not.toContain(bad);
    expect(b.config.webhook_url).toBe("https://hooks.example.com/x");
  });

  it("round-trips and marks imported messages simulated", () => {
    const b = buildExport({ contact: { name: "A", number: "1" }, lang: "es", chat: [{ id: "1", from: "them", kind: "message", text: "hola", at: 1, simulated: false }], recording: [] });
    const r = parseImport(JSON.stringify(b));
    expect(r.ok && r.bundle.conversation[0]!.simulated).toBe(true);
    expect(parseImport('{"format":"other"}').ok).toBe(false);
  });
});

describe("embed origin checking", () => {
  const parent = {};
  const ctx = { parentOrigin: "https://app.example.com", session: "abcdefgh1234", parentWindow: parent };
  const env = (o: Partial<{ origin: string; source: unknown; data: unknown }>) => ({ origin: "https://app.example.com", source: parent, data: { protocol: "browser-phone", v: 1, session: "abcdefgh1234", type: "incoming_call" }, ...o });

  it("accepts the declared parent with the right session", () => expect(validateInbound(env({}), ctx).ok).toBe(true));
  it("rejects other origins", () => expect(validateInbound(env({ origin: "https://evil.example.com" }), ctx)).toMatchObject({ ok: false, reason: "origin_mismatch" }));
  it("rejects other windows", () => expect(validateInbound(env({ source: {} }), ctx)).toMatchObject({ ok: false, reason: "source_mismatch" }));
  it("rejects wrong session", () => expect(validateInbound(env({ data: { protocol: "browser-phone", v: 1, session: "nope0000", type: "ping" } }), ctx)).toMatchObject({ ok: false, reason: "session_mismatch" }));
  it("is disabled without parent_origin", () => expect(validateInbound(env({}), { ...ctx, parentOrigin: null })).toMatchObject({ ok: false }));
  it("rejects non-https parent origins in params", () => expect(parseEmbedParams("?embed=1&parent_origin=http://evil.com&session=abcdefgh1234").parentOrigin).toBeNull());
});
