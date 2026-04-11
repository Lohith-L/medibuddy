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
      alert_history: {
        Row: {
          alert_type: string
          created_at: string
          delivery_channel: string | null
          dosage: string | null
          error_message: string | null
          id: string
          language_used: string | null
          medicine_id: string | null
          medicine_name: string | null
          message_preview: string | null
          patient_id: string
          recipient_email: string
          recipient_name: string | null
          scheduled_date: string | null
          scheduled_time: string | null
          status: string
        }
        Insert: {
          alert_type?: string
          created_at?: string
          delivery_channel?: string | null
          dosage?: string | null
          error_message?: string | null
          id?: string
          language_used?: string | null
          medicine_id?: string | null
          medicine_name?: string | null
          message_preview?: string | null
          patient_id: string
          recipient_email: string
          recipient_name?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          status?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          delivery_channel?: string | null
          dosage?: string | null
          error_message?: string | null
          id?: string
          language_used?: string | null
          medicine_id?: string | null
          medicine_name?: string | null
          message_preview?: string | null
          patient_id?: string
          recipient_email?: string
          recipient_name?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          status?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          alert_on_missed: boolean
          alert_on_refill: boolean
          alert_on_weekly_report: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          joined_at: string
          language: string
          patient_id: string
          phone: string | null
          relationship: string
        }
        Insert: {
          alert_on_missed?: boolean
          alert_on_refill?: boolean
          alert_on_weekly_report?: boolean
          created_at?: string
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          joined_at?: string
          language?: string
          patient_id: string
          phone?: string | null
          relationship: string
        }
        Update: {
          alert_on_missed?: boolean
          alert_on_refill?: boolean
          alert_on_weekly_report?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          joined_at?: string
          language?: string
          patient_id?: string
          phone?: string | null
          relationship?: string
        }
        Relationships: []
      }
      health_data: {
        Row: {
          calories: number | null
          created_at: string
          date: string
          heart_rate_avg: number | null
          id: string
          patient_id: string
          sleep_minutes: number | null
          source: string | null
          steps: number | null
          synced_at: string | null
        }
        Insert: {
          calories?: number | null
          created_at?: string
          date?: string
          heart_rate_avg?: number | null
          id?: string
          patient_id: string
          sleep_minutes?: number | null
          source?: string | null
          steps?: number | null
          synced_at?: string | null
        }
        Update: {
          calories?: number | null
          created_at?: string
          date?: string
          heart_rate_avg?: number | null
          id?: string
          patient_id?: string
          sleep_minutes?: number | null
          source?: string | null
          steps?: number | null
          synced_at?: string | null
        }
        Relationships: []
      }
      medicine_logs: {
        Row: {
          created_at: string
          id: string
          medicine_id: string
          patient_id: string
          scheduled_time: string
          status: string
          taken_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          medicine_id: string
          patient_id: string
          scheduled_time: string
          status?: string
          taken_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          medicine_id?: string
          patient_id?: string
          scheduled_time?: string
          status?: string
          taken_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicine_logs_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          created_at: string
          dosage: string
          end_date: string | null
          frequency: string
          id: string
          instructions: string | null
          is_active: boolean
          medicine_photo_url: string | null
          name: string
          patient_id: string
          reminder_times: string[] | null
          start_date: string | null
        }
        Insert: {
          created_at?: string
          dosage: string
          end_date?: string | null
          frequency: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          medicine_photo_url?: string | null
          name: string
          patient_id: string
          reminder_times?: string[] | null
          start_date?: string | null
        }
        Update: {
          created_at?: string
          dosage?: string
          end_date?: string | null
          frequency?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          medicine_photo_url?: string | null
          name?: string
          patient_id?: string
          reminder_times?: string[] | null
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicines_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          caregiver_email: string | null
          created_at: string
          email: string
          id: string
          language: string
          name: string
          phone: string | null
          user_id: string
        }
        Insert: {
          caregiver_email?: string | null
          created_at?: string
          email: string
          id?: string
          language?: string
          name: string
          phone?: string | null
          user_id: string
        }
        Update: {
          caregiver_email?: string | null
          created_at?: string
          email?: string
          id?: string
          language?: string
          name?: string
          phone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reminder_events: {
        Row: {
          caretaker_email: string | null
          created_at: string
          escalation_sent_at: string | null
          id: string
          medicine_id: string
          patient_id: string
          scheduled_date: string
          scheduled_time: string
          sent_at: string | null
          status: string
          taken_at: string | null
        }
        Insert: {
          caretaker_email?: string | null
          created_at?: string
          escalation_sent_at?: string | null
          id?: string
          medicine_id: string
          patient_id: string
          scheduled_date?: string
          scheduled_time: string
          sent_at?: string | null
          status?: string
          taken_at?: string | null
        }
        Update: {
          caretaker_email?: string | null
          created_at?: string
          escalation_sent_at?: string | null
          id?: string
          medicine_id?: string
          patient_id?: string
          scheduled_date?: string
          scheduled_time?: string
          sent_at?: string | null
          status?: string
          taken_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_events_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_send_logs: {
        Row: {
          created_at: string
          delivery_channel: string | null
          error_message: string | null
          id: string
          language_used: string | null
          medicine_id: string
          patient_email: string
          patient_id: string
          scheduled_for_date: string
          scheduled_for_time: string
          sent_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          delivery_channel?: string | null
          error_message?: string | null
          id?: string
          language_used?: string | null
          medicine_id: string
          patient_email: string
          patient_id: string
          scheduled_for_date: string
          scheduled_for_time: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          delivery_channel?: string | null
          error_message?: string | null
          id?: string
          language_used?: string | null
          medicine_id?: string
          patient_email?: string
          patient_id?: string
          scheduled_for_date?: string
          scheduled_for_time?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
