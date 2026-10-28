export type Lang = "en" | "es";
export type Mode = "offline" | "live";
export type Delivery = "sending" | "sent" | "delivered" | "read" | "failed";

export type ChatLink = { label: string; url: string; simulated?: boolean | undefined };

export type ChatItem = {
  id: string;
  from: "me" | "them";
  kind: "message" | "transcript" | "system";
  text: string;
  link?: ChatLink | undefined;
  at: number;
  status?: Delivery | undefined;
  simulated: boolean;
  error?: string | undefined;
};

export type CallStatus = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
export type CallState = {
  status: CallStatus;
  startedAt: number | null;
  muted: boolean;
  speaker: boolean;
  live: boolean; // real voice provider vs simulated
  endReason: string | null;
  note: string | null;
};

export type InspectorEntry = {
  id: string;
  at: number;
  label: string;
  method: string;
  url: string;
  request: unknown; // already redacted
  status: number | null;
  ok: boolean;
  latencyMs: number | null;
  response: unknown; // already redacted
  error: string | null;
  simulated: boolean;
};

export type Contact = { name: string; number: string };

export type LiveConnection = {
  apiBase: string;
  connectionId: string;
  webhookUrl: string;
  verified: boolean;
  // secrets – memory/sessionStorage only, never exported
  phoneToken: string;
  // A tester capability can create only sessions under this shared link.
  shareId?: string | undefined;
  signingSecret?: string | undefined;
};

export type RecordedEvent =
  | { t: number; type: "send"; text: string }
  | { t: number; type: "scenario"; name: ScenarioName }
  | { t: number; type: "call"; action: "start" | "answer" | "decline" | "hangup" | "incoming" };

export type ScenarioName = "incoming_call" | "incoming_message" | "delayed_reply" | "disconnect" | "failed_delivery" | "receipt_link" | "payment_link";
