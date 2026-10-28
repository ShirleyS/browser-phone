import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS build script
import { isExcluded, collect } from "../../scripts/build-source-archive.mjs";

describe("source archive allowlist", () => {
  it.each([".env", ".env.local", "src/.env.production", "node_modules/x/index.js", ".git/config", "logs/a.log", "public/downloads/browser-phone-source.zip", "src/.tanstack/tmp", "x/id_rsa", "credentials.json"])("excludes %s", (p) => expect(isExcluded(p)).toBe(true));
  it("keeps .env.example and source", () => {
    expect(isExcluded(".env.example")).toBe(false);
    const files: string[] = collect();
    for (const f of ["LICENSE", "README.md", ".env.example", "public/openapi.json", "package.json", "package-lock.json", "bun.lock"]) expect(files).toContain(f);
    expect(files.some((f) => f.startsWith("drizzle/migrations/"))).toBe(true);
    expect(files.some((f) => /(^|\/)\.env$/.test(f) || f.includes("node_modules"))).toBe(false);
  });
});
