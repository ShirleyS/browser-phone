import type { Contact, Lang } from "@/lib/phone/types";
export type SharedPhoneSettings = { contact: Contact; lang: Lang };
export type ShareSummary = {
  id: string;
  call_limit: number;
  calls_used: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};
export type CreateShareInput = {
  settings: SharedPhoneSettings;
  call_limit: number;
  expires_in_hours: number;
};
export type CreatedShare = { share: ShareSummary; token: string };
export type ShareInfo = {
  settings: SharedPhoneSettings;
  expires_at: string;
  usage: { used: number; limit: number; remaining: number; reset_at: string; verified: true };
};
export type ShareOwner = { apiBase: string; connectionId: string; phoneToken: string };
