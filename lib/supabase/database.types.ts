// lib/supabase/database.types.ts
//
// PLACEHOLDER — overwritten by `npm run db:types` once Supabase is wired up.
//
// Hand-typed only the three PII tables + their redacted views + the SQL
// functions the app calls. Matches supabase/migrations/20260519170002_tables.sql,
// 20260519170003_functions.sql, and 20260519170005_views.sql.
//
// Shape notes for hand-typing:
// - Use `type` aliases, not `interface`. Supabase-js's GenericTable
//   constraint (`Insert: Record<string, unknown>`) doesn't accept
//   nominal interfaces — `.insert(...)` collapses to `never` otherwise.
// - Every Tables entry needs `Relationships: []`.
// - Insert types must list every column explicitly with proper optionality.
// - Don't add hand types for additional tables here.

type Category = "officials" | "researchers" | "donors" | "ngos";
type Nationality = "jordanian" | "syrian" | "not_applicable";
type InvitationStatus =
  | "sent"
  | "opened"
  | "started"
  | "submitted"
  | "expired";
type TranscriptStatus =
  | "audio_only"
  | "transcribing"
  | "transcribed"
  | "anonymizing"
  | "published";
type Language = "en" | "ar";

type InvitationRow = {
  id: string;
  /** SHA-256 hex of the plaintext URL token. Plaintext is never stored. */
  token_hash: string;
  ref_code: string;
  recipient_name_encrypted: string;
  recipient_email_encrypted: string;
  category: Category;
  nationality: Nationality | null;
  preferred_language: Language;
  questionnaire_version_id: string;
  status: InvitationStatus;
  expires_at: string;
  use_count: number;
  max_uses: number;
  sent_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  created_at: string;
  created_by: string | null;
};

type InvitationInsert = {
  id?: string;
  token_hash: string;
  ref_code: string;
  recipient_name_encrypted: string;
  recipient_email_encrypted: string;
  category: Category;
  nationality?: Nationality | null;
  preferred_language?: Language;
  questionnaire_version_id: string;
  status?: InvitationStatus;
  expires_at: string;
  use_count?: number;
  max_uses?: number;
  sent_at?: string | null;
  opened_at?: string | null;
  started_at?: string | null;
  submitted_at?: string | null;
  created_at?: string;
  created_by?: string | null;
};

type InvitationUpdate = {
  id?: string;
  token_hash?: string;
  ref_code?: string;
  recipient_name_encrypted?: string;
  recipient_email_encrypted?: string;
  category?: Category;
  nationality?: Nationality | null;
  preferred_language?: Language;
  questionnaire_version_id?: string;
  status?: InvitationStatus;
  expires_at?: string;
  use_count?: number;
  max_uses?: number;
  sent_at?: string | null;
  opened_at?: string | null;
  started_at?: string | null;
  submitted_at?: string | null;
  created_at?: string;
  created_by?: string | null;
};

type RecordingRow = {
  id: string;
  response_id: string;
  audio_storage_path: string | null;
  audio_filename: string | null;
  audio_duration_seconds: number | null;
  audio_size_bytes: number | null;
  transcript_original: string | null;
  transcript_anonymized: string | null;
  substitution_key: Record<string, string> | null;
  language: Language | null;
  status: TranscriptStatus;
  uploaded_by: string | null;
  uploaded_at: string;
  published_at: string | null;
};

type RecordingInsert = {
  id?: string;
  response_id: string;
  audio_storage_path?: string | null;
  audio_filename?: string | null;
  audio_duration_seconds?: number | null;
  audio_size_bytes?: number | null;
  transcript_original?: string | null;
  transcript_anonymized?: string | null;
  substitution_key?: Record<string, string> | null;
  language?: Language | null;
  status?: TranscriptStatus;
  uploaded_by?: string | null;
  uploaded_at?: string;
  published_at?: string | null;
};

type RecordingUpdate = {
  id?: string;
  response_id?: string;
  audio_storage_path?: string | null;
  audio_filename?: string | null;
  audio_duration_seconds?: number | null;
  audio_size_bytes?: number | null;
  transcript_original?: string | null;
  transcript_anonymized?: string | null;
  substitution_key?: Record<string, string> | null;
  language?: Language | null;
  status?: TranscriptStatus;
  uploaded_by?: string | null;
  uploaded_at?: string;
  published_at?: string | null;
};

type ConsentRow = {
  id: string;
  response_id: string;
  signed_name_encrypted: string;
  signed_at: string;
  audio_consent: boolean;
  agreed_to_read: boolean;
  agreed_to_participate: boolean;
  consent_text_version: string;
  language: Language;
};

type ConsentInsert = {
  id?: string;
  response_id: string;
  signed_name_encrypted: string;
  signed_at?: string;
  audio_consent: boolean;
  agreed_to_read: boolean;
  agreed_to_participate: boolean;
  consent_text_version?: string;
  language: Language;
};

type ConsentUpdate = {
  id?: string;
  response_id?: string;
  signed_name_encrypted?: string;
  signed_at?: string;
  audio_consent?: boolean;
  agreed_to_read?: boolean;
  agreed_to_participate?: boolean;
  consent_text_version?: string;
  language?: Language;
};

// View row types. PII columns are typed as `null` (literal) since the
// view returns a static NULL::TYPE for them — readers never get a real
// value through the view regardless of role. Owner reads the base table
// via the repo to get the real ciphertext.

type InvitationRedactedRow = {
  id: string;
  // token_hash deliberately omitted — secret, never exposed via the view.
  ref_code: string;
  recipient_name_encrypted: null;
  recipient_email_encrypted: null;
  category: Category;
  nationality: Nationality | null;
  preferred_language: Language;
  questionnaire_version_id: string;
  status: InvitationStatus;
  expires_at: string;
  use_count: number;
  max_uses: number;
  sent_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  created_at: string;
  created_by: string | null;
};

type RecordingRedactedRow = {
  id: string;
  response_id: string;
  audio_storage_path: null;
  audio_filename: null;
  audio_duration_seconds: number | null;
  audio_size_bytes: number | null;
  transcript_original: null;
  // transcript_anonymized: non-null only when status = 'published'
  // (CASE expression in 20260519170005).
  transcript_anonymized: string | null;
  substitution_key: null;
  language: Language | null;
  status: TranscriptStatus;
  uploaded_by: string | null;
  uploaded_at: string;
  published_at: string | null;
};

type ConsentRedactedRow = {
  id: string;
  response_id: string;
  signed_name_encrypted: null;
  signed_at: string;
  audio_consent: boolean;
  agreed_to_read: boolean;
  agreed_to_participate: boolean;
  consent_text_version: string;
  language: Language;
};

// Return shape of validate_invitation_token. Narrow projection — no
// PII, no token_hash. Anon callers receive this via supabase.rpc().
//
// response_id distinguishes:
//   - resumption (existing non-submitted response) → string (UUID)
//   - fresh claim (route handler must create the response) → null
type ValidateInvitationTokenRow = {
  id: string;
  language: Language;
  nationality: Nationality | null;
  category: Category;
  questionnaire_version_id: string;
  expires_at: string;
  response_id: string | null;
};

export type Database = {
  public: {
    Tables: {
      invitations: {
        Row: InvitationRow;
        Insert: InvitationInsert;
        Update: InvitationUpdate;
        Relationships: [];
      };
      recordings: {
        Row: RecordingRow;
        Insert: RecordingInsert;
        Update: RecordingUpdate;
        Relationships: [];
      };
      consent_records: {
        Row: ConsentRow;
        Insert: ConsentInsert;
        Update: ConsentUpdate;
        Relationships: [];
      };
    };
    Views: {
      invitations_redacted: {
        Row: InvitationRedactedRow;
        Relationships: [];
      };
      recordings_redacted: {
        Row: RecordingRedactedRow;
        Relationships: [];
      };
      consent_records_redacted: {
        Row: ConsentRedactedRow;
        Relationships: [];
      };
    };
    Functions: {
      current_admin_role: {
        Args: Record<PropertyKey, never>;
        Returns: "owner" | "readonly" | null;
      };
      current_admin_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      validate_invitation_token: {
        Args: { p_token: string };
        // SETOF row — supabase-js returns this as an array of length 0 or 1.
        Returns: ValidateInvitationTokenRow[];
      };
    };
    Enums: {
      admin_role: "owner" | "readonly";
      category_type: Category;
      nationality_type: Nationality;
      invitation_status: InvitationStatus;
      transcript_status: TranscriptStatus;
    };
    CompositeTypes: Record<PropertyKey, never>;
  };
};
