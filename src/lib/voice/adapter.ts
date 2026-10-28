// Voice provider adapter interface. Add new providers by implementing VoiceAdapter
// and registering a factory in `voiceAdapters`.

export type VoiceConfig =
  | { provider: "elevenlabs"; transport: "websocket"; signed_url: string }
  | { provider: "elevenlabs"; transport: "webrtc"; conversation_token: string }
  | { provider: "elevenlabs"; agent_id: string; transport?: "websocket" | "webrtc" };

export type VoiceCallbacks = {
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onTranscript: (role: "user" | "agent", text: string) => void;
  onError: (message: string) => void;
};

export interface VoiceSession {
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  end(): Promise<void>;
}

export interface VoiceAdapter {
  id: string;
  supports(cfg: VoiceConfig): boolean;
  start(cfg: VoiceConfig, cb: VoiceCallbacks): Promise<VoiceSession>;
}

export type VoiceAdapterFactory = () => Promise<VoiceAdapter>;

export const voiceAdapters: Record<string, VoiceAdapterFactory> = {
  elevenlabs: async () => (await import("./elevenlabs")).elevenLabsAdapter,
};

export async function startVoice(cfg: VoiceConfig, cb: VoiceCallbacks): Promise<VoiceSession> {
  const f = voiceAdapters[cfg.provider];
  if (!f) throw new Error(`No adapter for provider ${cfg.provider}`);
  const a = await f();
  if (!a.supports(cfg)) throw new Error("Unsupported voice config");
  return a.start(cfg, cb);
}
