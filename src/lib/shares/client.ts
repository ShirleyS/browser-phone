import { boundedText } from "@/lib/shared/body";
import type { CreatedShare, CreateShareInput, ShareInfo, ShareOwner, ShareSummary } from "./types";

export class ShareRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ShareRequestError";
  }
}
export interface ShareClient {
  list(owner: ShareOwner): Promise<ShareSummary[]>;
  create(owner: ShareOwner, input: CreateShareInput): Promise<CreatedShare>;
  revoke(owner: ShareOwner, id: string): Promise<void>;
  info(id: string, token: string): Promise<ShareInfo>;
}
const base = "/api/public/v1";
export function isLocalShareOwner(owner: ShareOwner | null): boolean {
  if (!owner || typeof window === "undefined" || !owner.connectionId || !owner.phoneToken)
    return false;
  try {
    const url = new URL(owner.apiBase, window.location.origin);
    return (
      url.origin === window.location.origin &&
      url.pathname.replace(/\/$/, "") === base &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function ownerPath(owner: ShareOwner) {
  if (!isLocalShareOwner(owner))
    throw new Error("Share links require a connection on this same deployment.");
  return `/connections/${encodeURIComponent(owner.connectionId)}/shares`;
}
async function request<T>(path: string, token: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(base + path, {
    method,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = JSON.parse(await boundedText(response.body, 65536)) as T & {
    error?: { message?: string; code?: string };
  };
  if (!response.ok)
    throw new ShareRequestError(
      result.error?.message || "This test link is unavailable. Please try again.",
      response.status,
      result.error?.code,
    );
  return result;
}
export const shareClient: ShareClient = {
  list: async (owner) =>
    (await request<{ shares: ShareSummary[] }>(ownerPath(owner), owner.phoneToken)).shares,
  create: (owner, input) =>
    request(ownerPath(owner), owner.phoneToken, "POST", {
      settings: {
        contact: { name: input.settings.contact.name, number: input.settings.contact.number },
        lang: input.settings.lang,
      },
      call_limit: input.call_limit,
      expires_in_hours: input.expires_in_hours,
    }),
  revoke: async (owner, id) => {
    const result = await request<{ revoked: boolean }>(
      `${ownerPath(owner)}/${encodeURIComponent(id)}/revoke`,
      owner.phoneToken,
      "POST",
    );
    if (result.revoked !== true)
      throw new Error("This link could not be revoked. Please try again.");
  },
  info: (id, token) => request(`/shares/${encodeURIComponent(id)}`, token),
};
