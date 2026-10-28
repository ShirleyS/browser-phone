#!/usr/bin/env node
// Reproducible source archive with a strict allowlist.
//   node scripts/build-source-archive.mjs        → public/downloads/browser-phone-source.zip
// Same inputs → byte-identical zip (sorted entries, fixed timestamps, fixed compression).
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "public/downloads/browser-phone-source.zip";

// Only these paths are ever included (files or directories).
export const ALLOW = [
  "src", "public", "drizzle/migrations", "examples", "scripts", "docs", "supabase/config.toml",
  "package.json", "package-lock.json", "bun.lock", "bunfig.toml", "tsconfig.json", "vite.config.ts", "vite.node.config.ts", "vitest.config.ts",
  "components.json", "eslint.config.js", ".prettierrc", ".prettierignore", ".gitignore", "drizzle.config.ts",
  "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "RELEASE-REVIEW.md", "AGENTS.md", ".env.example",
];

// Anything matching these is dropped even inside allowed directories.
export function isExcluded(rel) {
  const parts = rel.split("/");
  const name = parts[parts.length - 1];
  if (parts.some((p) => [".git", "node_modules", ".tanstack", ".wrangler", ".output", "dist", ".nitro", ".vinxi", "coverage", "logs", ".cache", "downloads", ".lovable", ".workspace"].includes(p))) return true;
  if (/^\.env(\..*)?$/.test(name) && name !== ".env.example") return true;
  if (/\.(log|pem|key|p12|pfx|crt|sqlite|db|zip|tsbuildinfo)$/i.test(name)) return true;
  if (/^(\.dev\.vars|\.npmrc|credentials.*|secrets?\..*|id_rsa.*)$/i.test(name)) return true;
  if (rel === OUT) return true;
  return false;
}

function walk(abs, out) {
  const st = statSync(abs);
  const rel = relative(ROOT, abs).split(sep).join("/");
  if (isExcluded(rel)) return;
  if (st.isDirectory()) for (const e of readdirSync(abs).sort()) walk(join(abs, e), out);
  else if (st.isFile()) out.push(rel);
}

export function collect() {
  const files = [];
  for (const p of ALLOW) {
    try { walk(join(ROOT, p), files); } catch { /* optional path missing */ }
  }
  return [...new Set(files)].sort();
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const files = collect();
  const mtime = new Date("2026-01-01T00:00:00Z");
  const entries = {};
  for (const f of files) entries[`browser-phone/${f}`] = [readFileSync(join(ROOT, f)), { mtime, level: 9 }];
  const zip = zipSync(entries, { mtime, level: 9 });
  mkdirSync(join(ROOT, "public/downloads"), { recursive: true });
  writeFileSync(join(ROOT, OUT), zip);
  writeFileSync(join(ROOT, "public/downloads/browser-phone-source.files.txt"), files.join("\n") + "\n");
  const sha256 = createHash('sha256').update(zip).digest('hex');
  writeFileSync(join(ROOT, "public/downloads/browser-phone-source.sha256"), `${sha256}  browser-phone-source.zip\n`);
  console.log(`SHA256 ${sha256}`);
  console.log(`wrote ${OUT}: ${files.length} files, ${zip.length} bytes`);
}
