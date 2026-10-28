import type { Resolver } from '@/lib/shared/net';

export type PinnedOutbound = { resolve: Resolver; fetch: (url: string, init: { headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<Response> };
const key = Symbol.for('browser-phone.node-pinned-outbound.v1');
export function pinnedOutbound(): PinnedOutbound | null {
  return (globalThis as unknown as Record<symbol, PinnedOutbound | undefined>)[key] ?? null;
}