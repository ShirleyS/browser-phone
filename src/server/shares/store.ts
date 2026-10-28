import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { admin } from "@/server/bp/core";
export type SharedSettings = { contact: { name: string; number: string }; lang: "en" | "es" };
export type ShareRow = {
  id: string;
  connection_id: string;
  token_hash: string;
  settings: SharedSettings;
  call_limit: number;
  calls_used: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};
export type ShareSummary = Omit<ShareRow, "connection_id" | "token_hash" | "settings">;
export type NewShare = {
  id: string;
  connection_id: string;
  connection_hash: string;
  token_hash: string;
  settings: SharedSettings;
  call_limit: number;
  hours: number;
};
export type NewSharedSession = {
  share_id: string;
  share_hash: string;
  kind: "chat" | "call";
  idem: string;
  phone_hash: string;
  callback_hash: string;
  callback_token: string;
  daily_limit: number;
  max_concurrent: number;
  ttl_seconds: number;
  max_call_seconds: number;
};
export type SessionResult = {
  error?: string;
  id: string;
  kind: "chat" | "call";
  expires_at: string;
  call_deadline: string | null;
  replay: boolean;
  used?: number;
  limit?: number;
};
export type SharesDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Omit<Database["public"]["Tables"], "bp_sessions"> & {
      bp_sessions: Omit<
        Database["public"]["Tables"]["bp_sessions"],
        "Row" | "Insert" | "Update"
      > & {
        Row: Database["public"]["Tables"]["bp_sessions"]["Row"] & { share_id: string | null };
        Insert: Database["public"]["Tables"]["bp_sessions"]["Insert"] & {
          share_id?: string | null;
        };
        Update: Database["public"]["Tables"]["bp_sessions"]["Update"] & {
          share_id?: string | null;
        };
      };
      bp_shares: { Row: ShareRow; Insert: ShareRow; Update: Partial<ShareRow>; Relationships: [] };
    };
    Functions: Database["public"]["Functions"] & {
      bp_revoke_share: {
        Args: { _connection_id: string; _share_id: string; _connection_hash: string };
        Returns: boolean;
      };
      bp_create_share: {
        Args: {
          _id: string;
          _connection_id: string;
          _connection_hash: string;
          _token_hash: string;
          _settings: Json;
          _call_limit: number;
          _hours: number;
        };
        Returns: Json;
      };
      bp_create_shared_session: {
        Args: {
          _share_id: string;
          _share_hash: string;
          _kind: string;
          _idem: string;
          _phone_hash: string;
          _callback_hash: string;
          _callback_token: string;
          _daily_limit: number;
          _max_concurrent: number;
          _ttl_seconds: number;
          _max_call_seconds: number;
        };
        Returns: Json;
      };
    };
  };
};
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error("Share store unavailable");
  return result.data;
}
export async function createShareStore() {
  const db = (await admin()) as unknown as SupabaseClient<SharesDatabase>;
  return {
    async connection(id: string) {
      return checked(
        await db
          .from("bp_connections")
          .select("id,phone_token_hash,verified_at,revoked_at,token_expires_at")
          .eq("id", id)
          .maybeSingle(),
      );
    },
    async share(id: string) {
      return checked(await db.from("bp_shares").select("*").eq("id", id).maybeSingle());
    },
    async create(s: NewShare) {
      return checked(
        await db.rpc("bp_create_share", {
          _id: s.id,
          _connection_id: s.connection_id,
          _connection_hash: s.connection_hash,
          _token_hash: s.token_hash,
          _settings: s.settings,
          _call_limit: s.call_limit,
          _hours: s.hours,
        }),
      ) as unknown as ShareSummary & { error?: string };
    },
    async list(connectionId: string) {
      return (
        checked(
          await db
            .from("bp_shares")
            .select("id,call_limit,calls_used,expires_at,revoked_at,created_at")
            .eq("connection_id", connectionId)
            .is("revoked_at", null)
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(20),
        ) ?? []
      );
    },
    async revoke(connectionId: string, id: string, hash: string) {
      return checked(
        await db.rpc("bp_revoke_share", {
          _connection_id: connectionId,
          _share_id: id,
          _connection_hash: hash,
        }),
      );
    },
    async session(s: NewSharedSession) {
      return checked(
        await db.rpc("bp_create_shared_session", {
          _share_id: s.share_id,
          _share_hash: s.share_hash,
          _kind: s.kind,
          _idem: s.idem,
          _phone_hash: s.phone_hash,
          _callback_hash: s.callback_hash,
          _callback_token: s.callback_token,
          _daily_limit: s.daily_limit,
          _max_concurrent: s.max_concurrent,
          _ttl_seconds: s.ttl_seconds,
          _max_call_seconds: s.max_call_seconds,
        }),
      ) as unknown as SessionResult;
    },
  };
}
