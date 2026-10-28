// Export / import of sanitized config + synthetic conversations. Secrets never leave memory.
import { z } from "zod";
import { redact } from "@/lib/shared/redact";
import type { ChatItem, Contact, Lang, RecordedEvent } from "./types";

export const EXPORT_VERSION = 1;

export type ExportBundle = {
  format: "browser-phone";
  version: number;
  exported_at: string;
  config: { contact: Contact; lang: Lang; webhook_url?: string | undefined; connection_id?: string | undefined; agent_id?: string | undefined };
  conversation: Pick<ChatItem, "id" | "from" | "kind" | "text" | "link" | "at" | "status" | "simulated">[];
  recording: RecordedEvent[];
};

export function buildExport(input: {
  contact: Contact; lang: Lang; webhookUrl?: string | undefined; connectionId?: string | undefined; agentId?: string | undefined;
  chat: ChatItem[]; recording: RecordedEvent[];
}): ExportBundle {
  const bundle: ExportBundle = {
    format: "browser-phone",
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    config: { contact: input.contact, lang: input.lang, webhook_url: input.webhookUrl, connection_id: input.connectionId, agent_id: input.agentId },
    conversation: input.chat.map(({ id, from, kind, text, link, at, status, simulated }) => ({ id, from, kind, text, link, at, status, simulated })),
    recording: input.recording,
  };
  // Defense in depth: strip anything token-shaped and drop webhook query strings.
  if (bundle.config.webhook_url) {
    try {
      const u = new URL(bundle.config.webhook_url);
      u.search = "";
      bundle.config.webhook_url = u.toString();
    } catch {
      delete bundle.config.webhook_url;
    }
  }
  return redact(bundle);
}

const scenario = z.enum(["incoming_call", "incoming_message", "delayed_reply", "disconnect", "failed_delivery", "receipt_link", "payment_link"]);
const importSchema = z.object({
  format: z.literal("browser-phone"),
  version: z.number().int().min(1).max(EXPORT_VERSION),
  config: z.object({
    contact: z.object({ name: z.string().max(60), number: z.string().max(30) }),
    lang: z.enum(["en", "es"]),
    webhook_url: z.string().max(2048).optional(),
    agent_id: z.string().max(128).optional(),
  }).passthrough(),
  conversation: z.array(z.object({
    id: z.string().max(128), from: z.enum(["me", "them"]), kind: z.enum(["message", "transcript", "system"]),
    text: z.string().max(4000), at: z.number(),
    link: z.object({ label: z.string().max(80), url: z.string().max(2048), simulated: z.boolean().optional() }).optional(),
    status: z.enum(["sending", "sent", "delivered", "read", "failed"]).optional(),
    simulated: z.boolean(),
  })).max(2000),
  recording: z.array(z.union([
    z.object({ t: z.number(), type: z.literal("send"), text: z.string().max(4000) }),
    z.object({ t: z.number(), type: z.literal("scenario"), name: scenario }),
    z.object({ t: z.number(), type: z.literal("call"), action: z.enum(["start", "answer", "decline", "hangup", "incoming"]) }),
  ])).max(500),
});

export function parseImport(text: string): { ok: true; bundle: z.infer<typeof importSchema> } | { ok: false; error: string } {
  if (text.length > 2_000_000) return { ok: false, error: "File too large" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  const p = importSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Not a Browser Phone export: " + p.error.issues[0]?.path.join(".") };
  // Imported conversations are always treated as synthetic history; links only if https.
  p.data.conversation = p.data.conversation.map((c) => ({ ...c, simulated: true, link: c.link && c.link.url.startsWith("https://") ? c.link : undefined }));
  return { ok: true, bundle: redact(p.data) };
}
