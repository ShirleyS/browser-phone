import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareTestPhone } from "@/components/workbench/ShareTestPhone";
import { SharedTestPhone } from "@/components/phone/SharedTestPhone";
import { shareClient, ShareRequestError, type ShareClient } from "@/lib/shares/client";
import type { ShareInfo, ShareSummary } from "@/lib/shares/types";

const token = "bp_share_" + "a".repeat(43);
const settings = { contact: { name: "Test café", number: "+52 55 91100000" }, lang: "en" as const };
const summary: ShareSummary = {
  id: "shared-one",
  call_limit: 3,
  calls_used: 0,
  expires_at: "2099-01-02T00:00:00Z",
  revoked_at: null,
  created_at: "2026-10-28T00:00:00Z",
};
const info: ShareInfo = {
  settings,
  expires_at: summary.expires_at,
  usage: { used: 0, limit: 3, remaining: 3, reset_at: summary.expires_at, verified: true },
};
const owner = () => ({
  apiBase: window.location.origin + "/api/public/v1",
  connectionId: "owner-one",
  phoneToken: "bp_conn_private-owner",
  webhookUrl: "https://hooks.example.test/webhook",
  verified: true,
});
const fixture = (): ShareClient => ({
  list: vi.fn(async () => []),
  create: vi.fn(async () => ({ share: summary, token })),
  revoke: vi.fn(async () => {}),
  info: vi.fn(async () => info),
});
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
  };
}
beforeEach(() => {
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  localStorage.clear();
  Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, value: () => {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("owner shared phone controls", () => {
  it("stays collapsed and requires a verified local connection before any request", async () => {
    const client = fixture();
    const view = render(
      <ShareTestPhone state={{ ...settings, connection: null }} client={client} />,
    );
    expect(client.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Share a test phone" }));
    expect(screen.getByRole("button", { name: "Create test link" })).toBeDisabled();
    expect(client.list).not.toHaveBeenCalled();
    view.rerender(
      <ShareTestPhone
        state={{
          ...settings,
          connection: { ...owner(), apiBase: "https://elsewhere.test/api/public/v1" },
        }}
        client={client}
      />,
    );
    expect(screen.getByRole("button", { name: "Create test link" })).toBeDisabled();
    expect(client.list).not.toHaveBeenCalled();
  });
  it("creates the default allowance, copies only the tester URL, and explains forwarded attempts", async () => {
    const client = fixture();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ShareTestPhone state={{ ...settings, connection: owner() }} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Share a test phone" }));
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Create test link" }));
    await screen.findByRole("button", { name: "Copy test link" });
    expect(client.create).toHaveBeenCalledWith(owner(), {
      settings,
      call_limit: 3,
      expires_in_hours: 24,
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy test link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        window.location.origin + "/test/shared-one#key=" + token,
      ),
    );
    expect(document.body.textContent).not.toContain("bp_conn_private-owner");
    expect(screen.getByText(/forwarded links share/i)).toBeInTheDocument();
    expect(screen.getByText(/call attempts count/i)).toBeInTheDocument();
  });
  it("enforces custom integer bounds and sends the selected expiry", async () => {
    const client = fixture();
    render(<ShareTestPhone state={{ ...settings, connection: owner() }} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Share a test phone" }));
    await waitFor(() => expect(client.list).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Call allowance"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Custom call allowance"), { target: { value: "1.5" } });
    expect(screen.getByRole("button", { name: "Create test link" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Custom call allowance"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Link expires after"), { target: { value: "168" } });
    fireEvent.click(screen.getByRole("button", { name: "Create test link" }));
    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(owner(), {
        settings,
        call_limit: 100,
        expires_in_hours: 168,
      }),
    );
  });
  it("drops a late create response after the owner connection changes", async () => {
    const client = fixture(),
      pending = deferred<{ share: ShareSummary; token: string }>();
    client.create = vi.fn(() => pending.promise);
    const view = render(
      <ShareTestPhone state={{ ...settings, connection: owner() }} client={client} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share a test phone" }));
    await waitFor(() => expect(client.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Create test link" }));
    view.rerender(
      <ShareTestPhone
        state={{ ...settings, connection: { ...owner(), connectionId: "another-owner" } }}
        client={client}
      />,
    );
    await act(async () => pending.resolve({ share: summary, token }));
    expect(screen.queryByRole("button", { name: "Copy test link" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(token);
  });
  it("ignores late metadata from the previous connection", async () => {
    const client = fixture(),
      pending = deferred<ShareSummary[]>();
    client.list = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue([]);
    const view = render(
      <ShareTestPhone state={{ ...settings, connection: owner() }} client={client} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share a test phone" }));
    view.rerender(
      <ShareTestPhone
        state={{ ...settings, connection: { ...owner(), connectionId: "another-owner" } }}
        client={client}
      />,
    );
    await act(async () => pending.resolve([summary]));
    expect(screen.queryByText("shared-one")).not.toBeInTheDocument();
  });
  it("clears the fresh URL on revoke and lists only metadata after reload", async () => {
    const client = fixture();
    const view = render(
      <ShareTestPhone state={{ ...settings, connection: owner() }} client={client} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share a test phone" }));
    await waitFor(() => expect(client.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Create test link" }));
    await screen.findByRole("button", { name: "Copy test link" });
    fireEvent.click(screen.getByRole("button", { name: "Revoke shared-one" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Copy test link" })).not.toBeInTheDocument(),
    );
    expect(client.revoke).toHaveBeenCalledWith(owner(), "shared-one");
    view.unmount();
    client.list = vi.fn(async () => [summary]);
    render(<ShareTestPhone state={{ ...settings, connection: owner() }} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Share a test phone" }));
    await screen.findByText("shared-one");
    expect(screen.queryByRole("button", { name: "Copy test link" })).not.toBeInTheDocument();
    expect(screen.getByText(/create a new link if/i)).toBeInTheDocument();
  });
});

describe("bounded same-origin shares client", () => {
  it("rejects foreign owner API bases without sending capabilities", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      shareClient.list({ ...owner(), apiBase: "https://evil.example/api/public/v1" }),
    ).rejects.toThrow(/same deployment/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends only approved shared settings to the fixed local API", async () => {
    const fetcher = vi.fn(
      async (_url: string, _options?: RequestInit) =>
        new Response(JSON.stringify({ share: summary, token }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await shareClient.create(owner(), {
      settings: { ...settings, agentId: "private-agent" } as typeof settings,
      call_limit: 3,
      expires_in_hours: 24,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/public/v1/connections/owner-one/shares",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer bp_conn_private-owner" }),
      }),
    );
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain("private-agent");
  });
  it("rejects oversized responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ shares: [], padding: "x".repeat(65536) }))),
    );
    await expect(shareClient.list(owner())).rejects.toThrow(/limit/i);
  });
});

describe("tester shared phone", () => {
  it("captures and removes the fragment, stays isolated from owner storage, and opens without reserving a call", async () => {
    localStorage.setItem(
      "browser-phone:prefs",
      JSON.stringify({
        contact: { name: "Private owner", number: "secret" },
        agentId: "owner-agent",
      }),
    );
    sessionStorage.setItem("browser-phone:connection", "private owner connection");
    window.history.replaceState({}, "", "/test/shared-one#key=" + token);
    const client = fixture();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<SharedTestPhone id="shared-one" client={client} />);
    expect(await screen.findByText("Test café")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(sessionStorage.getItem("browser-phone:share:shared-one")).toBe(token);
    expect(sessionStorage.getItem("browser-phone:connection")).toBe("private owner connection");
    expect(localStorage.getItem("browser-phone:prefs")).toContain("owner-agent");
    expect(fetcher).not.toHaveBeenCalled();
    expect(client.info).toHaveBeenCalledWith("shared-one", token);
    expect(screen.getByText(/3 of 3 calls remaining/i)).toBeInTheDocument();
    expect(screen.queryByText("Private owner")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share a test phone" })).not.toBeInTheDocument();
  });
  it("reloads a per-tab token and lets exhausted testers keep messaging", async () => {
    sessionStorage.setItem("browser-phone:share:shared-one", token);
    const client = fixture();
    client.info = vi.fn(async () => ({ ...info, usage: { ...info.usage, used: 3, remaining: 0 } }));
    render(<SharedTestPhone id="shared-one" client={client} />);
    expect(await screen.findByText(/0 of 3 calls remaining/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText(/messages remain available/i)).toBeInTheDocument();
  });
  it("blocks missing and invalid capabilities without contacting the API", async () => {
    window.history.replaceState({}, "", "/test/shared-one#key=bad");
    const client = fixture();
    render(<SharedTestPhone id="shared-one" client={client} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/complete test link/i);
    expect(client.info).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
  it("clears unavailable capabilities and blocks the phone", async () => {
    sessionStorage.setItem("browser-phone:share:shared-one", token);
    const client = fixture();
    client.info = vi.fn(async () => {
      throw new ShareRequestError("This link is unavailable.", 410, "share_unavailable");
    });
    render(<SharedTestPhone id="shared-one" client={client} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    expect(sessionStorage.getItem("browser-phone:share:shared-one")).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("blocks an open phone when its link is revoked on the next info refresh", async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.setItem("browser-phone:share:shared-one", token);
      const client = fixture();
      client.info = vi
        .fn()
        .mockResolvedValueOnce(info)
        .mockRejectedValueOnce(new ShareRequestError("Revoked", 410, "share_unavailable"));
      render(<SharedTestPhone id="shared-one" client={client} />);
      await act(async () => {});
      expect(screen.getByRole("textbox")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(sessionStorage.getItem("browser-phone:share:shared-one")).toBeNull();
      expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i);
    } finally {
      vi.useRealTimers();
    }
  });
  it("updates allowance spent by another tester after this phone has cached usage", async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.setItem("browser-phone:share:shared-one", token);
      const client = fixture();
      client.info = vi
        .fn()
        .mockResolvedValueOnce(info)
        .mockResolvedValue({ ...info, usage: { ...info.usage, used: 2, remaining: 1 } });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.endsWith("/sessions"))
            return new Response(
              JSON.stringify({
                id: "call-one",
                kind: "call",
                phone_token: "session-phone",
                expires_at: new Date(Date.now() + 60000).toISOString(),
                call_deadline: null,
                idempotent_replay: false,
              }),
              { status: 201 },
            );
          if (url.endsWith("/shares/shared-one"))
            return new Response(
              JSON.stringify({ ...info, usage: { ...info.usage, used: 1, remaining: 2 } }),
            );
          return new Response(
            JSON.stringify({ delivery: { ok: false, error: "Provider unavailable" } }),
          );
        }),
      );
      render(<SharedTestPhone id="shared-one" client={client} />);
      await act(async () => {});
      fireEvent.click(screen.getByRole("button", { name: "Call" }));
      await act(async () => {});
      expect(screen.getByText(/2 of 3 calls remaining/i)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(screen.getByText(/1 of 3 calls remaining/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps expiry terminal when an earlier info refresh completes afterward", async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.setItem("browser-phone:share:shared-one", token);
      const pending = deferred<ShareInfo>(),
        client = fixture();
      client.info = vi
        .fn()
        .mockResolvedValueOnce({ ...info, expires_at: new Date(Date.now() + 16000).toISOString() })
        .mockImplementationOnce(() => pending.promise);
      render(<SharedTestPhone id="shared-one" client={client} />);
      await act(async () => {});
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16000);
      });
      expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i);
      await act(async () => pending.resolve(info));
      expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it("blocks an expired open phone without waiting for a request", async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.setItem("browser-phone:share:shared-one", token);
      const client = fixture();
      client.info = vi.fn(async () => ({
        ...info,
        expires_at: new Date(Date.now() + 5000).toISOString(),
      }));
      render(<SharedTestPhone id="shared-one" client={client} />);
      await act(async () => {});
      expect(screen.getByRole("textbox")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(sessionStorage.getItem("browser-phone:share:shared-one")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("ignores info arriving after navigation to a different share", async () => {
    const pending = deferred<ShareInfo>();
    sessionStorage.setItem("browser-phone:share:shared-one", token);
    const client = fixture();
    client.info = vi.fn(() => pending.promise);
    const view = render(<SharedTestPhone id="shared-one" client={client} />);
    view.rerender(<SharedTestPhone id="different-share" client={client} />);
    await act(async () => pending.resolve(info));
    expect(screen.queryByText("Test café")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
