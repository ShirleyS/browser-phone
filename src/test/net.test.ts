import { describe, expect, it } from "vitest";
import { assertPublicWebhook, checkWebhookUrl, isPrivateAddress, nextUtcMidnight, webhookFingerprint } from "@/lib/shared/net";

describe("SSRF / webhook URL validation", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1"])(
    "rejects private/reserved address %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("accepts public %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it("requires https and rejects localhost, internal names and credentials", () => {
    expect(checkWebhookUrl("http://example.com/x")).toMatchObject({ ok: false, reason: "https_required" });
    expect(checkWebhookUrl("https://localhost/x")).toMatchObject({ ok: false, reason: "private_address" });
    expect(checkWebhookUrl("https://db.internal/x")).toMatchObject({ ok: false, reason: "private_address" });
    expect(checkWebhookUrl("https://[::1]/x")).toMatchObject({ ok: false, reason: "private_address" });
    expect(checkWebhookUrl("https://2130706433/")).toMatchObject({ ok: false });
    expect(checkWebhookUrl("https://u:p@example.com/")).toMatchObject({ ok: false, reason: "credentials_in_url" });
  });

  it("rejects hostnames that resolve to private IPs (DNS rebinding style)", async () => {
    const r = await assertPublicWebhook("https://evil.example.com/hook", async () => ["93.184.216.34", "10.0.0.5"]);
    expect(r).toMatchObject({ ok: false, reason: "private_address" });
    const ok = await assertPublicWebhook("https://good.example.com/hook", async () => ["93.184.216.34"]);
    expect(ok.ok).toBe(true);
    const none = await assertPublicWebhook("https://nx.example.com/hook", async () => []);
    expect(none).toMatchObject({ ok: false, reason: "dns_no_records" });
  });

  it("fingerprint ignores query, fragment, trailing slash and default port so quota can't be reset", () => {
    const a = webhookFingerprint(new URL("https://Hooks.Example.com:443/a/?x=1#y"));
    const b = webhookFingerprint(new URL("https://hooks.example.com/a"));
    expect(a).toBe(b);
  });

  it("daily reset is next UTC midnight", () => {
    expect(nextUtcMidnight(new Date("2026-10-28T23:59:59Z")).toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-10-29T00:00:00Z")).toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });
});
