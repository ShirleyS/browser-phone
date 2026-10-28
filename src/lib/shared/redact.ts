// Redaction used by the inspector and by every export/download.

const SECRET_KEYS = /^(authorization|callback_token|phone_token|token|signing_secret|secret|signed_url|conversation_token|api[_-]?key|xi-api-key|password|code|pairing_code|access_token)$/i;
const TOKEN_PATTERNS: RegExp[] = [
  /bp_(?:phone|cb|conn|sess)_[A-Za-z0-9_-]{8,}/g,
  /whsec_[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /sk_[A-Za-z0-9]{16,}/g,
];

export const REDACTED = "[redacted]";

export function redactString(s: string): string {
  let out = s;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, REDACTED);
  // URLs at any depth: discard credentials, all query values and fragments.
  out = out.replace(/(?:https?|wss?):\/\/[^\s"<>]+/gi, (raw) => {
    try {
      const u = new URL(raw); u.username = ""; u.password = "";
      const query = u.search ? `?${REDACTED}` : "";
      return `${u.protocol}//${u.host}${u.pathname}${query}${u.hash ? `#${REDACTED}` : ""}`;
    } catch { return REDACTED; }
  });
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 12) return REDACTED as unknown as T;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) && v != null && v !== "" ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
