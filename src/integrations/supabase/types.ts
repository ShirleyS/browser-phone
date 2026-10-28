export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      bp_connections: {
        Row: {
          created_at: string
          fingerprint: string
          id: string
          pairing_attempts: number
          pairing_code_hash: string | null
          pairing_expires_at: string | null
          phone_token_hash: string
          revoked_at: string | null
          signing_secret: string
          token_expires_at: string
          verified_at: string | null
          webhook_url: string
        }
        Insert: {
          created_at?: string
          fingerprint: string
          id?: string
          pairing_attempts?: number
          pairing_code_hash?: string | null
          pairing_expires_at?: string | null
          phone_token_hash: string
          revoked_at?: string | null
          signing_secret: string
          token_expires_at?: string
          verified_at?: string | null
          webhook_url: string
        }
        Update: {
          created_at?: string
          fingerprint?: string
          id?: string
          pairing_attempts?: number
          pairing_code_hash?: string | null
          pairing_expires_at?: string | null
          phone_token_hash?: string
          revoked_at?: string | null
          signing_secret?: string
          token_expires_at?: string
          verified_at?: string | null
          webhook_url?: string
        }
        Relationships: []
      }
      bp_events: {
        Row: {
          created_at: string
          delivery_state: string
          delivery_status: number | null
          error: string | null
          event_id: string
          latency_ms: number | null
          lease_id: string | null
          lease_until: string | null
          request_json: Json | null
          response_json: Json | null
          response_status: number | null
          session_id: string
          type: string
        }
        Insert: {
          created_at?: string
          delivery_state?: string
          delivery_status?: number | null
          error?: string | null
          event_id: string
          latency_ms?: number | null
          lease_id?: string | null
          lease_until?: string | null
          request_json?: Json | null
          response_json?: Json | null
          response_status?: number | null
          session_id: string
          type: string
        }
        Update: {
          created_at?: string
          delivery_state?: string
          delivery_status?: number | null
          error?: string | null
          event_id?: string
          latency_ms?: number | null
          lease_id?: string | null
          lease_until?: string | null
          request_json?: Json | null
          response_json?: Json | null
          response_status?: number | null
          session_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bp_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      bp_messages: {
        Row: {
          created_at: string
          direction: string
          external_id: string
          link: Json | null
          seq: number
          session_id: string
          text: string | null
          type: string
        }
        Insert: {
          created_at?: string
          direction: string
          external_id: string
          link?: Json | null
          seq?: number
          session_id: string
          text?: string | null
          type: string
        }
        Update: {
          created_at?: string
          direction?: string
          external_id?: string
          link?: Json | null
          seq?: number
          session_id?: string
          text?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bp_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      bp_sessions: {
        Row: {
          call_deadline: string | null
          callback_token: string | null
          callback_token_hash: string
          connection_id: string
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          idempotency_key: string
          kind: string
          phone_token_hash: string
          status: string
        }
        Insert: {
          call_deadline?: string | null
          callback_token?: string | null
          callback_token_hash: string
          connection_id: string
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          idempotency_key: string
          kind: string
          phone_token_hash: string
          status?: string
        }
        Update: {
          call_deadline?: string | null
          callback_token?: string | null
          callback_token_hash?: string
          connection_id?: string
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          kind?: string
          phone_token_hash?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bp_sessions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "bp_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      bp_usage: {
        Row: {
          count: number
          day: string
          fingerprint: string
          kind: string
        }
        Insert: {
          count?: number
          day: string
          fingerprint: string
          kind: string
        }
        Update: {
          count?: number
          day?: string
          fingerprint?: string
          kind?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bp_bump_usage: {
        Args: { _fp: string; _kind: string; _limit: number }
        Returns: boolean
      }
      bp_claim_event: {
        Args: {
          _event_id: string
          _lease: string
          _request: Json
          _session_id: string
          _type: string
        }
        Returns: Json
      }
      bp_create_session: {
        Args: {
          _callback_hash: string
          _connection_id: string
          _daily_limit: number
          _idem: string
          _kind: string
          _max_call_seconds: number
          _max_concurrent: number
          _phone_hash: string
          _ttl_seconds: number
        }
        Returns: Json
      }
      bp_finish_event: {
        Args: {
          _event_id: string
          _lease: string
          _ok: boolean
          _response: Json
          _session_id: string
          _status: number
        }
        Returns: boolean
      }
      bp_insert_message: {
        Args: {
          _direction: string
          _external_id: string
          _link: Json
          _session_id: string
          _text: string
          _type: string
        }
        Returns: Json
      }
      bp_verify_pairing: {
        Args: { _candidate_hash: string; _connection_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
