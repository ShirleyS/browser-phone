import type { VoiceConfig } from './adapter';

// Official WebSocket guide establishes this host/path. Regional REST hosts
// are not evidence of regional WebSocket support. Fail closed for other hosts.
export function validVoiceConfig(value: unknown): value is VoiceConfig {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  if (c['provider'] !== 'elevenlabs') return false;
  if (typeof c['signed_url'] === 'string') {
    try {
      const u = new URL(c['signed_url']);
      const keys = [...u.searchParams.keys()];
      return c['transport'] === 'websocket' && c['signed_url'].length <= 4096 &&
        u.protocol === 'wss:' && u.hostname === 'api.elevenlabs.io' && !u.port && !u.username && !u.password && !u.hash &&
        u.pathname === '/v1/convai/conversation' && keys.length === 2 && new Set(keys).size === 2 &&
        keys.every(k => k === 'agent_id' || k === 'token') &&
        /^[A-Za-z0-9_-]{4,128}$/.test(u.searchParams.get('agent_id') || '') &&
        /^[A-Za-z0-9._~-]{8,4096}$/.test(u.searchParams.get('token') || '');
    } catch { return false; }
  }
  // Opaque third-party WebRTC tokens may embed destinations. Not accepted
  // until destination validation can be proven; trusted SDK public-agent flow is supported.
  if ('conversation_token' in c) return false;
  return typeof c['agent_id'] === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(c['agent_id']) &&
    (!c['transport'] || c['transport'] === 'websocket' || c['transport'] === 'webrtc');
}