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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          activated_at: string | null
          email: string
          id: string
          invited_at: string
          name: string
          removed_at: string | null
          role: Database["public"]["Enums"]["admin_role"]
          status: string
        }
        Insert: {
          activated_at?: string | null
          email: string
          id?: string
          invited_at?: string
          name: string
          removed_at?: string | null
          role: Database["public"]["Enums"]["admin_role"]
          status?: string
        }
        Update: {
          activated_at?: string | null
          email?: string
          id?: string
          invited_at?: string
          name?: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["admin_role"]
          status?: string
        }
        Relationships: []
      }
      answer_options: {
        Row: {
          answer_id: string
          option_id: string
        }
        Insert: {
          answer_id: string
          option_id: string
        }
        Update: {
          answer_id?: string
          option_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answer_options_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_options_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "question_options"
            referencedColumns: ["id"]
          },
        ]
      }
      answers: {
        Row: {
          answer_comment: string | null
          answer_text: string
          id: string
          question_id: string
          response_id: string
          updated_at: string
          word_count: number | null
        }
        Insert: {
          answer_comment?: string | null
          answer_text?: string
          id?: string
          question_id: string
          response_id: string
          updated_at?: string
          word_count?: number | null
        }
        Update: {
          answer_comment?: string | null
          answer_text?: string
          id?: string
          question_id?: string
          response_id?: string
          updated_at?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_admin_id: string | null
          actor_name: string | null
          actor_role: Database["public"]["Enums"]["admin_role"] | null
          city: string | null
          country: string | null
          id: string
          ip: string | null
          metadata: Json
          resource: string
          severity: Database["public"]["Enums"]["event_severity"]
          ts: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_admin_id?: string | null
          actor_name?: string | null
          actor_role?: Database["public"]["Enums"]["admin_role"] | null
          city?: string | null
          country?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
          resource?: string
          severity?: Database["public"]["Enums"]["event_severity"]
          ts?: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_admin_id?: string | null
          actor_name?: string | null
          actor_role?: Database["public"]["Enums"]["admin_role"] | null
          city?: string | null
          country?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
          resource?: string
          severity?: Database["public"]["Enums"]["event_severity"]
          ts?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_admin_id_fkey"
            columns: ["actor_admin_id"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
      backups: {
        Row: {
          created_at: string
          created_by: string | null
          filename: string
          id: string
          pinned: boolean
          size_bytes: number
          storage_path: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filename: string
          id?: string
          pinned?: boolean
          size_bytes: number
          storage_path: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          pinned?: boolean
          size_bytes?: number
          storage_path?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "backups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          agreed_to_participate: boolean
          agreed_to_read: boolean
          audio_consent: boolean
          consent_text_version: string
          id: string
          language: string
          response_id: string
          signed_at: string
          signed_name_encrypted: string
        }
        Insert: {
          agreed_to_participate: boolean
          agreed_to_read: boolean
          audio_consent: boolean
          consent_text_version?: string
          id?: string
          language: string
          response_id: string
          signed_at?: string
          signed_name_encrypted: string
        }
        Update: {
          agreed_to_participate?: boolean
          agreed_to_read?: boolean
          audio_consent?: boolean
          consent_text_version?: string
          id?: string
          language?: string
          response_id?: string
          signed_at?: string
          signed_name_encrypted?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: true
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          bcc_owner: boolean
          description: string
          id: string
          name: string
          sections_ar: Json | null
          sections_en: Json
          subject_ar: string | null
          subject_en: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bcc_owner?: boolean
          description?: string
          id: string
          name: string
          sections_ar?: Json | null
          sections_en?: Json
          subject_ar?: string | null
          subject_en: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bcc_owner?: boolean
          description?: string
          id?: string
          name?: string
          sections_ar?: Json | null
          sections_en?: Json
          subject_ar?: string | null
          subject_en?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          access_code_encrypted: string | null
          access_code_used_at: string | null
          batch_id: string | null
          category: Database["public"]["Enums"]["category_type"]
          collection_mode: Database["public"]["Enums"]["collection_mode"]
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          last_send_failed_at: string | null
          max_uses: number
          nationality: Database["public"]["Enums"]["nationality_type"] | null
          opened_at: string | null
          preferred_language: string
          questionnaire_version_id: string
          recipient_email_encrypted: string
          recipient_name_encrypted: string
          ref_code: string
          reminder_final_sent_at: string | null
          reminder1_sent_at: string | null
          sent_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["invitation_status"]
          submitted_at: string | null
          token_hash: string
          token_plaintext_encrypted: string | null
          use_count: number
        }
        Insert: {
          access_code_encrypted?: string | null
          access_code_used_at?: string | null
          batch_id?: string | null
          category: Database["public"]["Enums"]["category_type"]
          collection_mode?: Database["public"]["Enums"]["collection_mode"]
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          last_send_failed_at?: string | null
          max_uses?: number
          nationality?: Database["public"]["Enums"]["nationality_type"] | null
          opened_at?: string | null
          preferred_language?: string
          questionnaire_version_id: string
          recipient_email_encrypted: string
          recipient_name_encrypted: string
          ref_code: string
          reminder_final_sent_at?: string | null
          reminder1_sent_at?: string | null
          sent_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          submitted_at?: string | null
          token_hash: string
          token_plaintext_encrypted?: string | null
          use_count?: number
        }
        Update: {
          access_code_encrypted?: string | null
          access_code_used_at?: string | null
          batch_id?: string | null
          category?: Database["public"]["Enums"]["category_type"]
          collection_mode?: Database["public"]["Enums"]["collection_mode"]
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          last_send_failed_at?: string | null
          max_uses?: number
          nationality?: Database["public"]["Enums"]["nationality_type"] | null
          opened_at?: string | null
          preferred_language?: string
          questionnaire_version_id?: string
          recipient_email_encrypted?: string
          recipient_name_encrypted?: string
          ref_code?: string
          reminder_final_sent_at?: string | null
          reminder1_sent_at?: string | null
          sent_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          submitted_at?: string | null
          token_hash?: string
          token_plaintext_encrypted?: string | null
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_questionnaire_version_id_fkey"
            columns: ["questionnaire_version_id"]
            isOneToOne: false
            referencedRelation: "questionnaire_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          admin_id: string
          failed_login_email: boolean
          failed_login_inapp: boolean
          invitation_opened_email: boolean
          invitation_opened_inapp: boolean
          invitation_sent_email: boolean
          invitation_sent_inapp: boolean
          stalled_email: boolean
          stalled_inapp: boolean
          submission_email: boolean
          submission_inapp: boolean
          weekly_digest: boolean
        }
        Insert: {
          admin_id: string
          failed_login_email?: boolean
          failed_login_inapp?: boolean
          invitation_opened_email?: boolean
          invitation_opened_inapp?: boolean
          invitation_sent_email?: boolean
          invitation_sent_inapp?: boolean
          stalled_email?: boolean
          stalled_inapp?: boolean
          submission_email?: boolean
          submission_inapp?: boolean
          weekly_digest?: boolean
        }
        Update: {
          admin_id?: string
          failed_login_email?: boolean
          failed_login_inapp?: boolean
          invitation_opened_email?: boolean
          invitation_opened_inapp?: boolean
          invitation_sent_email?: boolean
          invitation_sent_inapp?: boolean
          stalled_email?: boolean
          stalled_inapp?: boolean
          submission_email?: boolean
          submission_inapp?: boolean
          weekly_digest?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: true
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          href: string | null
          id: string
          read_at: string | null
          recipient_admin_id: string
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          body?: string
          created_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          recipient_admin_id: string
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          body?: string
          created_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          recipient_admin_id?: string
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_admin_id_fkey"
            columns: ["recipient_admin_id"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
      question_options: {
        Row: {
          id: string
          label_ar: string
          label_en: string
          option_code: string
          order_index: number
          question_id: string
        }
        Insert: {
          id?: string
          label_ar: string
          label_en: string
          option_code: string
          order_index: number
          question_id: string
        }
        Update: {
          id?: string
          label_ar?: string
          label_en?: string
          option_code?: string
          order_index?: number
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaire_versions: {
        Row: {
          closed_at: string | null
          id: string
          includes_feedback_block: boolean
          published_at: string | null
          status: Database["public"]["Enums"]["version_status"]
          type: Database["public"]["Enums"]["questionnaire_type"]
          variant: Database["public"]["Enums"]["questionnaire_variant"]
          version_number: number
        }
        Insert: {
          closed_at?: string | null
          id?: string
          includes_feedback_block?: boolean
          published_at?: string | null
          status?: Database["public"]["Enums"]["version_status"]
          type: Database["public"]["Enums"]["questionnaire_type"]
          variant: Database["public"]["Enums"]["questionnaire_variant"]
          version_number: number
        }
        Update: {
          closed_at?: string | null
          id?: string
          includes_feedback_block?: boolean
          published_at?: string | null
          status?: Database["public"]["Enums"]["version_status"]
          type?: Database["public"]["Enums"]["questionnaire_type"]
          variant?: Database["public"]["Enums"]["questionnaire_variant"]
          version_number?: number
        }
        Relationships: []
      }
      questions: {
        Row: {
          allow_comment: boolean
          allow_skip: boolean
          answer_type: Database["public"]["Enums"]["answer_type"]
          id: string
          is_feedback: boolean
          is_required: boolean
          order_index: number
          question_code: string
          text_ar: string
          text_en: string
          version_id: string
          visible_nationalities:
            | Database["public"]["Enums"]["nationality_type"][]
            | null
        }
        Insert: {
          allow_comment?: boolean
          allow_skip?: boolean
          answer_type?: Database["public"]["Enums"]["answer_type"]
          id?: string
          is_feedback?: boolean
          is_required?: boolean
          order_index: number
          question_code: string
          text_ar: string
          text_en: string
          version_id: string
          visible_nationalities?:
            | Database["public"]["Enums"]["nationality_type"][]
            | null
        }
        Update: {
          allow_comment?: boolean
          allow_skip?: boolean
          answer_type?: Database["public"]["Enums"]["answer_type"]
          id?: string
          is_feedback?: boolean
          is_required?: boolean
          order_index?: number
          question_code?: string
          text_ar?: string
          text_en?: string
          version_id?: string
          visible_nationalities?:
            | Database["public"]["Enums"]["nationality_type"][]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "questionnaire_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings: {
        Row: {
          audio_duration_seconds: number | null
          audio_filename: string | null
          audio_size_bytes: number | null
          audio_storage_path: string | null
          id: string
          language: string | null
          published_at: string | null
          response_id: string
          status: Database["public"]["Enums"]["transcript_status"]
          substitution_key: Json | null
          transcript_anonymized: string | null
          transcript_original: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          audio_duration_seconds?: number | null
          audio_filename?: string | null
          audio_size_bytes?: number | null
          audio_storage_path?: string | null
          id?: string
          language?: string | null
          published_at?: string | null
          response_id: string
          status?: Database["public"]["Enums"]["transcript_status"]
          substitution_key?: Json | null
          transcript_anonymized?: string | null
          transcript_original?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          audio_duration_seconds?: number | null
          audio_filename?: string | null
          audio_size_bytes?: number | null
          audio_storage_path?: string | null
          id?: string
          language?: string | null
          published_at?: string | null
          response_id?: string
          status?: Database["public"]["Enums"]["transcript_status"]
          substitution_key?: Json | null
          transcript_anonymized?: string | null
          transcript_original?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recordings_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
      researcher_notes: {
        Row: {
          note_text: string
          response_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          note_text?: string
          response_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          note_text?: string
          response_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "researcher_notes_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: true
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "researcher_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
      response_tags: {
        Row: {
          applied_at: string
          applied_by: string | null
          response_id: string
          tag_id: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          response_id: string
          tag_id: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          response_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_tags_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_tags_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      responses: {
        Row: {
          duration_minutes: number | null
          id: string
          invitation_id: string
          is_locked: boolean
          language: string
          started_at: string
          status: string
          submitted_at: string | null
          withdrawn_at: string | null
        }
        Insert: {
          duration_minutes?: number | null
          id?: string
          invitation_id: string
          is_locked?: boolean
          language: string
          started_at?: string
          status?: string
          submitted_at?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          duration_minutes?: number | null
          id?: string
          invitation_id?: string
          is_locked?: boolean
          language?: string
          started_at?: string
          status?: string
          submitted_at?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "responses_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responses_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "invitations_redacted"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tags: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      consent_records_redacted: {
        Row: {
          agreed_to_participate: boolean | null
          agreed_to_read: boolean | null
          audio_consent: boolean | null
          consent_text_version: string | null
          id: string | null
          language: string | null
          response_id: string | null
          signed_at: string | null
          signed_name_encrypted: string | null
        }
        Insert: {
          agreed_to_participate?: boolean | null
          agreed_to_read?: boolean | null
          audio_consent?: boolean | null
          consent_text_version?: string | null
          id?: string | null
          language?: string | null
          response_id?: string | null
          signed_at?: string | null
          signed_name_encrypted?: never
        }
        Update: {
          agreed_to_participate?: boolean | null
          agreed_to_read?: boolean | null
          audio_consent?: boolean | null
          consent_text_version?: string | null
          id?: string | null
          language?: string | null
          response_id?: string | null
          signed_at?: string | null
          signed_name_encrypted?: never
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: true
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations_redacted: {
        Row: {
          access_code_used_at: string | null
          category: Database["public"]["Enums"]["category_type"] | null
          collection_mode: Database["public"]["Enums"]["collection_mode"] | null
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string | null
          last_send_failed_at: string | null
          max_uses: number | null
          nationality: Database["public"]["Enums"]["nationality_type"] | null
          opened_at: string | null
          preferred_language: string | null
          questionnaire_version_id: string | null
          recipient_email_encrypted: string | null
          recipient_name_encrypted: string | null
          ref_code: string | null
          reminder_final_sent_at: string | null
          reminder1_sent_at: string | null
          sent_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["invitation_status"] | null
          submitted_at: string | null
          use_count: number | null
        }
        Insert: {
          access_code_used_at?: string | null
          category?: Database["public"]["Enums"]["category_type"] | null
          collection_mode?:
            | Database["public"]["Enums"]["collection_mode"]
            | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string | null
          last_send_failed_at?: string | null
          max_uses?: number | null
          nationality?: Database["public"]["Enums"]["nationality_type"] | null
          opened_at?: string | null
          preferred_language?: string | null
          questionnaire_version_id?: string | null
          recipient_email_encrypted?: never
          recipient_name_encrypted?: never
          ref_code?: string | null
          reminder_final_sent_at?: string | null
          reminder1_sent_at?: string | null
          sent_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"] | null
          submitted_at?: string | null
          use_count?: number | null
        }
        Update: {
          access_code_used_at?: string | null
          category?: Database["public"]["Enums"]["category_type"] | null
          collection_mode?:
            | Database["public"]["Enums"]["collection_mode"]
            | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string | null
          last_send_failed_at?: string | null
          max_uses?: number | null
          nationality?: Database["public"]["Enums"]["nationality_type"] | null
          opened_at?: string | null
          preferred_language?: string | null
          questionnaire_version_id?: string | null
          recipient_email_encrypted?: never
          recipient_name_encrypted?: never
          ref_code?: string | null
          reminder_final_sent_at?: string | null
          reminder1_sent_at?: string | null
          sent_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"] | null
          submitted_at?: string | null
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_questionnaire_version_id_fkey"
            columns: ["questionnaire_version_id"]
            isOneToOne: false
            referencedRelation: "questionnaire_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings_redacted: {
        Row: {
          audio_duration_seconds: number | null
          audio_filename: string | null
          audio_size_bytes: number | null
          audio_storage_path: string | null
          id: string | null
          language: string | null
          published_at: string | null
          response_id: string | null
          status: Database["public"]["Enums"]["transcript_status"] | null
          substitution_key: Json | null
          transcript_anonymized: string | null
          transcript_original: string | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          audio_duration_seconds?: number | null
          audio_filename?: never
          audio_size_bytes?: number | null
          audio_storage_path?: never
          id?: string | null
          language?: string | null
          published_at?: string | null
          response_id?: string | null
          status?: Database["public"]["Enums"]["transcript_status"] | null
          substitution_key?: never
          transcript_anonymized?: never
          transcript_original?: never
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          audio_duration_seconds?: number | null
          audio_filename?: never
          audio_size_bytes?: number | null
          audio_storage_path?: never
          id?: string | null
          language?: string | null
          published_at?: string | null
          response_id?: string | null
          status?: Database["public"]["Enums"]["transcript_status"] | null
          substitution_key?: never
          transcript_anonymized?: never
          transcript_original?: never
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recordings_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      commit_consent_sign: {
        Args: {
          p_agreed_to_participate: boolean
          p_agreed_to_read: boolean
          p_audio_consent: boolean
          p_consent_text_version?: string
          p_language: string
          p_response_id: string
          p_signed_name_encrypted: string
        }
        Returns: string
      }
      current_admin: {
        Args: never
        Returns: {
          id: string
          name: string
          role: Database["public"]["Enums"]["admin_role"]
        }[]
      }
      current_admin_id: { Args: never; Returns: string }
      current_admin_role: {
        Args: never
        Returns: Database["public"]["Enums"]["admin_role"]
      }
      decrypt_pii: { Args: { p_ciphertext: string }; Returns: string }
      encrypt_pii: { Args: { p_plaintext: string }; Returns: string }
      log_audit: {
        Args: {
          p_action: string
          p_ip?: string
          p_metadata?: Json
          p_resource?: string
          p_severity?: Database["public"]["Enums"]["event_severity"]
          p_user_agent?: string
        }
        Returns: undefined
      }
      save_choice_answer: {
        Args: {
          p_comment?: string
          p_option_ids: string[]
          p_question_id: string
          p_response_id: string
        }
        Returns: string
      }
      validate_invitation_code: {
        Args: { p_code: string }
        Returns: {
          category: Database["public"]["Enums"]["category_type"]
          expires_at: string
          id: string
          language: string
          nationality: Database["public"]["Enums"]["nationality_type"]
          questionnaire_version_id: string
          ref_code: string
          response_id: string
        }[]
      }
      validate_invitation_token: {
        Args: { p_token: string }
        Returns: {
          category: Database["public"]["Enums"]["category_type"]
          expires_at: string
          id: string
          language: string
          nationality: Database["public"]["Enums"]["nationality_type"]
          questionnaire_version_id: string
          ref_code: string
          response_id: string
        }[]
      }
    }
    Enums: {
      admin_role: "owner" | "readonly"
      answer_type: "free_text" | "single_choice" | "multi_choice"
      category_type: "officials" | "researchers" | "donors" | "ngos"
      collection_mode: "self_completed" | "interview"
      event_severity: "info" | "warn" | "alert"
      invitation_status:
        | "sent"
        | "opened"
        | "started"
        | "submitted"
        | "expired"
        | "revoked"
        | "pending"
      nationality_type: "jordanian" | "syrian" | "not_applicable"
      notification_type: "submission" | "invitation" | "system"
      questionnaire_type: "pilot" | "main"
      questionnaire_variant:
        | "pilot_officials"
        | "pilot_researchers_donors_ngos"
        | "main_researchers"
        | "main_donors"
        | "main_ngos"
        | "main_officials_jordanian"
        | "main_officials_syrian"
        | "pilot_researchers"
        | "pilot_donors"
        | "pilot_ngos"
      transcript_status:
        | "audio_only"
        | "transcribing"
        | "transcribed"
        | "anonymizing"
        | "published"
      version_status: "draft" | "active" | "closed"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      admin_role: ["owner", "readonly"],
      answer_type: ["free_text", "single_choice", "multi_choice"],
      category_type: ["officials", "researchers", "donors", "ngos"],
      collection_mode: ["self_completed", "interview"],
      event_severity: ["info", "warn", "alert"],
      invitation_status: [
        "sent",
        "opened",
        "started",
        "submitted",
        "expired",
        "revoked",
        "pending",
      ],
      nationality_type: ["jordanian", "syrian", "not_applicable"],
      notification_type: ["submission", "invitation", "system"],
      questionnaire_type: ["pilot", "main"],
      questionnaire_variant: [
        "pilot_officials",
        "pilot_researchers_donors_ngos",
        "main_researchers",
        "main_donors",
        "main_ngos",
        "main_officials_jordanian",
        "main_officials_syrian",
        "pilot_researchers",
        "pilot_donors",
        "pilot_ngos",
      ],
      transcript_status: [
        "audio_only",
        "transcribing",
        "transcribed",
        "anonymizing",
        "published",
      ],
      version_status: ["draft", "active", "closed"],
    },
  },
} as const
