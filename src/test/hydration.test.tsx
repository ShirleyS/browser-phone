import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { EmbedSection } from "@/components/workbench/Workbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("embed snippet hydration", () => {
  it("server markup is deterministic and hydrates without mismatch", async () => {
    const a = renderToString(<EmbedSection state={{ lang: "en" }} />);
    const b = renderToString(<EmbedSection state={{ lang: "en" }} />);
    expect(a).toBe(b); // no random nonce in SSR
    expect(a).not.toContain("embed=1");

    const container = document.createElement("div");
    container.innerHTML = a;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
    await act(async () => {
      hydrateRoot(container, <EmbedSection state={{ lang: "en" }} />, { onRecoverableError: (e) => errors.push(e) });
    });
    spy.mockRestore();
    expect(errors).toEqual([]);
    // after mount, the snippet with the real origin appears
    expect(container.textContent).toContain(`${window.location.origin}/?embed=1`);
  });
});
