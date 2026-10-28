// ElevenLabs adapter: browser audio connects directly to ElevenLabs.
// No ElevenLabs API key is ever handled here — only public agent IDs or
// short-lived signed URLs / conversation tokens minted by the developer's backend.
import type { VoiceAdapter } from "./adapter";
import { validVoiceConfig } from './validate';

export const elevenLabsAdapter: VoiceAdapter = {
  id: "elevenlabs",
  supports: (cfg) => cfg.provider === "elevenlabs",
  async start(cfg, cb) {
    if (!validVoiceConfig(cfg)) throw new Error('Unsafe voice configuration');
    const { Conversation } = await import("@elevenlabs/client");
    const callbacks = {
      onConnect: () => cb.onConnected(),
      onDisconnect: (d: { reason: string }) => cb.onDisconnected(d?.reason ?? "disconnected"),
      onError: (m: unknown) => cb.onError(typeof m === "string" ? m : "Voice provider error"),
      onMessage: (m: { message: string; role?: string; source?: string }) =>
        cb.onTranscript(m.role === "agent" || m.source === "ai" ? "agent" : "user", m.message),
    };
    let opts: Record<string, unknown>;
    if ("signed_url" in cfg) opts = { signedUrl: cfg.signed_url, connectionType: "websocket" };
    else if ("conversation_token" in cfg) opts = { conversationToken: cfg.conversation_token, connectionType: "webrtc" };
    else opts = { agentId: cfg.agent_id, connectionType: cfg.transport ?? "webrtc" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conv: any = await (Conversation as any).startSession({ ...opts, ...callbacks });
    return {
      setMuted: (m) => conv.setMicMuted?.(m),
      setVolume: (v) => conv.setVolume?.({ volume: v }),
      end: async () => {
        await conv.endSession?.();
      },
    };
  },
};
