import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneEngine, type Deps } from "@/lib/phone/engine";

function makeDeps() {
  const fetchSpy = vi.fn(async () => new Response("{}"));
  const track = { stop: vi.fn() };
  const voiceEnd = vi.fn(async () => {});
  let n = 0;
  const deps: Deps = {
    fetch: fetchSpy as unknown as typeof fetch,
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    getUserMedia: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
    startVoice: vi.fn(async (_c, cb) => { cb.onConnected(); return { setMuted() {}, setVolume() {}, end: voiceEnd }; }),
    uuid: () => `id${++n}`,
  };
  return { deps, fetchSpy, track, voiceEnd };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("offline engine", () => {
  it("sends, shows delivery states and a labeled demo reply without any network call", async () => {
    const { deps, fetchSpy } = makeDeps();
    const e = new PhoneEngine(deps);
    await e.sendMessage("where is my order");
    expect(e.state.chat[0]!.status).toBe("sending");
    vi.advanceTimersByTime(2500);
    expect(e.state.chat[0]!.status).toBe("read");
    expect(e.state.chat[1]).toMatchObject({ from: "them", simulated: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("failed delivery scenario marks failed, never fake success", async () => {
    const { deps } = makeDeps();
    const e = new PhoneEngine(deps);
    e.runScenario("failed_delivery");
    await e.sendMessage("hi");
    vi.advanceTimersByTime(3000);
    const mine = e.state.chat.find((c) => c.from === "me")!;
    expect(mine.status).toBe("failed");
    expect(e.state.chat.filter((c) => c.id.startsWith("r-"))).toHaveLength(0);
  });

  it("replay of a recording sends nothing external even when in live mode", async () => {
    const { deps, fetchSpy } = makeDeps();
    const e = new PhoneEngine(deps, { mode: "live", connection: { apiBase: "https://x.test/api/public/v1", connectionId: "c", webhookUrl: "https://h", verified: true, phoneToken: "bp_conn_x" } });
    e.loadRecording([{ t: 0, type: "send", text: "hello" }, { t: 100, type: "call", action: "start" }, { t: 3000, type: "call", action: "hangup" }, { t: 3100, type: "scenario", name: "payment_link" }]);
    e.replay();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(e.state.mode).toBe("live");
    expect(e.state.chat.some((c) => c.link?.simulated)).toBe(true);
  });

  it("engines are isolated from each other", async () => {
    const a = new PhoneEngine(makeDeps().deps);
    const b = new PhoneEngine(makeDeps().deps);
    await a.sendMessage("secret A");
    expect(b.state.chat).toHaveLength(0);
  });
});

describe("call state and cleanup", () => {
  it("simulated incoming call: answer, mute, hangup and timers cleared", async () => {
    const { deps, fetchSpy } = makeDeps();
    const e = new PhoneEngine(deps);
    e.runScenario("incoming_call");
    expect(e.state.call.status).toBe("incoming");
    e.answer();
    expect(e.state.call.status).toBe("active");
    e.toggleMute();
    expect(e.state.call.muted).toBe(true);
    await e.hangup();
    expect(e.state.call.status).toBe("ended");
    expect(e.resources.timers.size).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(e.state.call.status).toBe("idle");
    expect(deps.getUserMedia).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live agent-id call requests mic only after dialing and releases mic + voice on hangup", async () => {
    const { deps, voiceEnd, track } = makeDeps();
    const e = new PhoneEngine(deps, { mode: "live", agentId: "agent_123" });
    expect(deps.getUserMedia).not.toHaveBeenCalled();
    e.startCall();
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.getUserMedia).toHaveBeenCalledTimes(1);
    expect(e.state.call).toMatchObject({ status: "active", live: true });
    expect(track.stop).toHaveBeenCalled();
    await e.hangup();
    expect(voiceEnd).toHaveBeenCalled();
    expect(e.resources.voice).toBeNull();
    expect(e.resources.stream).toBeNull();
  });

  it("mic denied falls back to an honest simulated call", async () => {
    const { deps } = makeDeps();
    deps.getUserMedia = vi.fn(async () => { throw new Error("NotAllowedError"); });
    const e = new PhoneEngine(deps, { mode: "live", agentId: "agent_123" });
    e.startCall();
    await vi.advanceTimersByTimeAsync(10);
    expect(e.state.call).toMatchObject({ status: "active", live: false });
    expect(e.state.call.note).toMatch(/Microphone blocked/);
    expect(deps.startVoice).not.toHaveBeenCalled();
  });

  it("dispose clears chat timers", async () => {
    const { deps } = makeDeps();
    const e = new PhoneEngine(deps);
    await e.sendMessage("x");
    expect(e.activeTimerCount).toBeGreaterThan(0);
    await e.dispose();
    expect(e.activeTimerCount).toBe(0);
  });
});
