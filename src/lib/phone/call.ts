import type { CallState } from "./types";

export const initialCall: CallState = { status: "idle", startedAt: null, muted: false, speaker: false, live: false, endReason: null, note: null };

export type CallAction =
  | { type: "dial" }
  | { type: "incoming" }
  | { type: "connecting"; live: boolean }
  | { type: "connected"; at: number; live: boolean; note?: string | null }
  | { type: "decline" }
  | { type: "toggleMute" }
  | { type: "toggleSpeaker" }
  | { type: "hangup"; reason?: string }
  | { type: "note"; note: string | null }
  | { type: "reset" };

export function callReducer(s: CallState, a: CallAction): CallState {
  switch (a.type) {
    case "dial":
      return s.status === "idle" || s.status === "ended" ? { ...initialCall, status: "outgoing" } : s;
    case "incoming":
      return s.status === "idle" || s.status === "ended" ? { ...initialCall, status: "incoming" } : s;
    case "connecting":
      return s.status === "outgoing" || s.status === "incoming" ? { ...s, status: "connecting", live: a.live } : s;
    case "connected":
      return s.status === "connecting" || s.status === "outgoing" || s.status === "incoming" ? { ...s, status: "active", startedAt: a.at, live: a.live, note: a.note ?? s.note } : s;
    case "decline":
      return s.status === "incoming" || s.status === "outgoing" ? { ...initialCall, status: "ended", endReason: "declined" } : s;
    case "toggleMute":
      return s.status === "active" ? { ...s, muted: !s.muted } : s;
    case "toggleSpeaker":
      return s.status === "active" ? { ...s, speaker: !s.speaker } : s;
    case "hangup":
      return s.status === "idle" || s.status === "ended" ? s : { ...initialCall, status: "ended", endReason: a.reason ?? "hangup" };
    case "note":
      return { ...s, note: a.note };
    case "reset":
      return initialCall;
  }
}

/** Resources a call may hold; cleanup must release all of them. */
export type CallResources = { timers: Set<ReturnType<typeof setTimeout>>; stream: MediaStream | null; voice: { end: () => Promise<void> | void } | null };
export function newResources(): CallResources {
  return { timers: new Set(), stream: null, voice: null };
}
export async function cleanupCall(r: CallResources) {
  for (const id of r.timers) clearTimeout(id);
  r.timers.clear();
  if (r.stream) {
    for (const tr of r.stream.getTracks()) tr.stop();
    r.stream = null;
  }
  const v = r.voice;
  r.voice = null;
  if (v) {
    try {
      await v.end();
    } catch {
      /* already closed */
    }
  }
}
