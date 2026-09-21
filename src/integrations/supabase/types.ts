export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      applications: {
        Row: {
          id: string
          user_id: string
          scholarship_id: string | null
          status: string
          disbursement_status: string
          amount_approved: number | null
          notes: string | null
          academic_year: string | null
          semester: string | null
          is_renewal: boolean
          statement: string | null
          household_income: number | null
          household_size: number | null
          certified_at: string | null
          school_name: string | null
          course: string | null
          year_level: string | null
          average_grade: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          scholarship_id?: string | null
          status?: string
          disbursement_status?: string
          amount_approved?: number | null
          notes?: string | null
          academic_year?: string | null
          semester?: string | null
          is_renewal?: boolean
          statement?: string | null
          household_income?: number | null
          household_size?: number | null
          certified_at?: string | null
          school_name?: string | null
          course?: string | null
          year_level?: string | null
          average_grade?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          scholarship_id?: string | null
          status?: string
          disbursement_status?: string
          amount_approved?: number | null
          notes?: string | null
          academic_year?: string | null
          semester?: string | null
          is_renewal?: boolean
          statement?: string | null
          household_income?: number | null
          household_size?: number | null
          certified_at?: string | null
          school_name?: string | null
          course?: string | null
          year_level?: string | null
          average_grade?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_scholarship_id_fkey"
            columns: ["scholarship_id"]
            isOneToOne: false
            referencedRelation: "scholarships"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          id: string
          user_id: string
          application_id: string | null
          document_type: string
          file_url: string
          file_name: string
          uploaded_at: string
          storage_path: string | null
          file_size: number | null
          mime_type: string | null
          status: string
          review_note: string | null
          reviewed_by: string | null
          reviewed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          application_id?: string | null
          document_type: string
          file_url: string
          file_name: string
          uploaded_at?: string
          storage_path?: string | null
          file_size?: number | null
          mime_type?: string | null
          status?: string
          review_note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          application_id?: string | null
          document_type?: string
          file_url?: string
          file_name?: string
          uploaded_at?: string
          storage_path?: string | null
          file_size?: number | null
          mime_type?: string | null
          status?: string
          review_note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          user_id: string
          category: string
          in_app: boolean
          email: boolean
        }
        Insert: {
          user_id: string
          category: string
          in_app?: boolean
          email?: boolean
        }
        Update: {
          user_id?: string
          category?: string
          in_app?: boolean
          email?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          message: string
          type: string
          read: boolean
          created_at: string
          category: string
          link: string | null
          entity_type: string | null
          entity_id: string | null
          dedupe_key: string | null
          muted: boolean
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          message: string
          type?: string
          read?: boolean
          created_at?: string
          category?: string
          link?: string | null
          entity_type?: string | null
          entity_id?: string | null
          dedupe_key?: string | null
          muted?: boolean
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          message?: string
          type?: string
          read?: boolean
          created_at?: string
          category?: string
          link?: string | null
          entity_type?: string | null
          entity_id?: string | null
          dedupe_key?: string | null
          muted?: boolean
        }
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          application_id: string | null
          user_id: string
          amount: number
          method: string
          reference: string | null
          status: string
          scheduled_date: string | null
          disbursed_at: string | null
          created_at: string
          receipt_path: string | null
          notes: string | null
          student_receipt_path: string | null
          student_receipt_at: string | null
          preferred_method: string | null
          receipt_review_status: string
          receipt_review_note: string | null
          receipt_reviewed_by: string | null
          receipt_reviewed_at: string | null
          cancel_reason: string | null
        }
        Insert: {
          id?: string
          application_id?: string | null
          user_id: string
          amount: number
          method?: string
          reference?: string | null
          status?: string
          scheduled_date?: string | null
          disbursed_at?: string | null
          created_at?: string
          receipt_path?: string | null
          notes?: string | null
          student_receipt_path?: string | null
          student_receipt_at?: string | null
          preferred_method?: string | null
          receipt_review_status?: string
          receipt_review_note?: string | null
          receipt_reviewed_by?: string | null
          receipt_reviewed_at?: string | null
          cancel_reason?: string | null
        }
        Update: {
          id?: string
          application_id?: string | null
          user_id?: string
          amount?: number
          method?: string
          reference?: string | null
          status?: string
          scheduled_date?: string | null
          disbursed_at?: string | null
          created_at?: string
          receipt_path?: string | null
          notes?: string | null
          student_receipt_path?: string | null
          student_receipt_at?: string | null
          preferred_method?: string | null
          receipt_review_status?: string
          receipt_review_note?: string | null
          receipt_reviewed_by?: string | null
          receipt_reviewed_at?: string | null
          cancel_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_issues: {
        Row: {
          id: string
          payment_id: string
          user_id: string
          kind: string
          message: string
          status: string
          response: string | null
          created_at: string
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          id?: string
          payment_id: string
          user_id: string
          kind: string
          message: string
          status?: string
          response?: string | null
          created_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          id?: string
          payment_id?: string
          user_id?: string
          kind?: string
          message?: string
          status?: string
          response?: string | null
          created_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: []
      }
      grade_updates: {
        Row: {
          id: string
          user_id: string
          grade: number
          term: string
          file_path: string
          status: string
          review_note: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          grade: number
          term: string
          file_path: string
          status?: string
          review_note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          grade?: number
          term?: string
          file_path?: string
          status?: string
          review_note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      data_requests: {
        Row: {
          id: string
          user_id: string
          kind: string
          reason: string | null
          status: string
          response: string | null
          created_at: string
          handled_at: string | null
          handled_by: string | null
        }
        Insert: {
          id?: string
          user_id: string
          kind?: string
          reason?: string | null
          status?: string
          response?: string | null
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          kind?: string
          reason?: string | null
          status?: string
          response?: string | null
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          user_id: string
          email_enabled: boolean
          in_app_enabled: boolean
          updated_at: string
        }
        Insert: {
          user_id: string
          email_enabled?: boolean
          in_app_enabled?: boolean
          updated_at?: string
        }
        Update: {
          user_id?: string
          email_enabled?: boolean
          in_app_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          id: string
          title: string
          message: string
          audience: string
          link: string | null
          recipient_count: number
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          message: string
          audience: string
          link?: string | null
          recipient_count?: number
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          message?: string
          audience?: string
          link?: string | null
          recipient_count?: number
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          email: string | null
          first_name: string | null
          middle_name: string | null
          last_name: string | null
          sex: string | null
          civil_status: string | null
          nationality: string | null
          dob: string | null
          phone: string | null
          barangay: string | null
          municipality: string | null
          profile_picture_url: string | null
          school_name: string | null
          course: string | null
          year_level: string | null
          average_grade: number | null
          street_address: string | null
          province: string | null
          zip_code: string | null
          guardian_name: string | null
          guardian_relationship: string | null
          guardian_phone: string | null
          grade_verified_at: string | null
          grade_term: string | null
          student_id_number: string | null
          government_id: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          first_name?: string | null
          middle_name?: string | null
          last_name?: string | null
          sex?: string | null
          civil_status?: string | null
          nationality?: string | null
          dob?: string | null
          phone?: string | null
          barangay?: string | null
          municipality?: string | null
          profile_picture_url?: string | null
          school_name?: string | null
          course?: string | null
          year_level?: string | null
          average_grade?: number | null
          street_address?: string | null
          province?: string | null
          zip_code?: string | null
          guardian_name?: string | null
          guardian_relationship?: string | null
          guardian_phone?: string | null
          grade_verified_at?: string | null
          grade_term?: string | null
          student_id_number?: string | null
          government_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          first_name?: string | null
          middle_name?: string | null
          last_name?: string | null
          sex?: string | null
          civil_status?: string | null
          nationality?: string | null
          dob?: string | null
          phone?: string | null
          barangay?: string | null
          municipality?: string | null
          profile_picture_url?: string | null
          school_name?: string | null
          course?: string | null
          year_level?: string | null
          average_grade?: number | null
          street_address?: string | null
          province?: string | null
          zip_code?: string | null
          guardian_name?: string | null
          guardian_relationship?: string | null
          guardian_phone?: string | null
          grade_verified_at?: string | null
          grade_term?: string | null
          student_id_number?: string | null
          government_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      scholarships: {
        Row: {
          id: string
          name: string
          description: string | null
          amount: number
          slots: number
          total_budget: number
          is_active: boolean
          deadline: string | null
          eligibility: string | null
          created_at: string
          open_date: string | null
          min_grade: number | null
          year_levels: string[] | null
          municipality: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          amount?: number
          slots?: number
          total_budget?: number
          is_active?: boolean
          deadline?: string | null
          eligibility?: string | null
          created_at?: string
          open_date?: string | null
          min_grade?: number | null
          year_levels?: string[] | null
          municipality?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          amount?: number
          slots?: number
          total_budget?: number
          is_active?: boolean
          deadline?: string | null
          eligibility?: string | null
          created_at?: string
          open_date?: string | null
          min_grade?: number | null
          year_levels?: string[] | null
          municipality?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: "admin" | "student"
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role: "admin" | "student"
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          role?: "admin" | "student"
          created_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: string
          user_id: string | null
          user_email: string | null
          action: string
          entity_type: string
          entity_id: string | null
          previous_value: Json | null
          new_value: Json | null
          ip_address: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          user_email?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          previous_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          user_email?: string | null
          action?: string
          entity_type?: string
          entity_id?: string | null
          previous_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          id: string
          key: string
          value: Json
          description: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          value: Json
          description?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          value?: Json
          description?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scholar_verifications: {
        Row: {
          id: string
          application_id: string | null
          user_id: string
          student_id_number: string | null
          government_id: string | null
          has_existing_scholarship: boolean
          existing_scholarship_details: string | null
          verification_status: string
          verified_by: string | null
          verified_at: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          application_id?: string | null
          user_id: string
          student_id_number?: string | null
          government_id?: string | null
          has_existing_scholarship?: boolean
          existing_scholarship_details?: string | null
          verification_status?: string
          verified_by?: string | null
          verified_at?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          application_id?: string | null
          user_id?: string
          student_id_number?: string | null
          government_id?: string | null
          has_existing_scholarship?: boolean
          existing_scholarship_details?: string | null
          verification_status?: string
          verified_by?: string | null
          verified_at?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      scholarships_public: {
        Args: Record<string, never>
        Returns: {
          id: string
          name: string
          description: string | null
          amount: number | null
          slots: number
          slots_left: number | null
          deadline: string | null
          open_date: string | null
          eligibility: string | null
          min_grade: number | null
          year_levels: string[] | null
          municipality: string | null
          created_at: string
          availability: "open" | "upcoming" | "closed" | "full"
        }[]
      }
      has_role: {
        Args: {
          _role: "admin" | "student"
          _user_id: string
        }
        Returns: boolean
      }
      set_payment_preference: {
        Args: {
          _payment_id: string
          _method: string
        }
        Returns: undefined
      }
      report_payment_issue: {
        Args: {
          _payment_id: string
          _kind: string
          _message: string
        }
        Returns: string
      }
      resolve_payment_issue: {
        Args: {
          _issue_id: string
          _response: string
        }
        Returns: undefined
      }
      review_student_receipt: {
        Args: {
          _payment_id: string
          _status: string
          _note?: string | null
        }
        Returns: undefined
      }
      submit_grade_update: {
        Args: {
          _grade: number
          _term: string
          _path: string
        }
        Returns: string
      }
      review_grade_update: {
        Args: {
          _id: string
          _status: string
          _note?: string | null
        }
        Returns: undefined
      }
      request_account_deletion: {
        Args: {
          _reason?: string | null
        }
        Returns: string
      }
      handle_data_request: {
        Args: {
          _id: string
          _status: string
          _response: string
        }
        Returns: undefined
      }
      send_announcement: {
        Args: {
          _title: string
          _message: string
          _audience: string
          _link?: string | null
        }
        Returns: number
      }
      notification_jobs_status: {
        Args: Record<string, never>
        Returns: {
          cron_available: boolean
          scheduled: boolean
          schedule: string | null
          last_run_at: string | null
          last_ok_at: string | null
          last_error: string | null
          runs: number
        }[]
      }
      run_notification_jobs_now: {
        Args: Record<string, never>
        Returns: undefined
      }
      send_test_notification: {
        Args: Record<string, never>
        Returns: undefined
      }
      submit_student_receipt: {
        Args: {
          _payment_id: string
          _path?: string | null
        }
        Returns: undefined
      }
      set_student_active: {
        Args: {
          _user_id: string
          _active: boolean
        }
        Returns: undefined
      }
      is_admin: {
        Args: {
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "student"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  TableName extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
> = (DefaultSchema["Tables"] & DefaultSchema["Views"])[TableName] extends {
  Row: infer R
}
  ? R
  : never

export type TablesInsert<
  TableName extends keyof DefaultSchema["Tables"]
> = DefaultSchema["Tables"][TableName] extends {
  Insert: infer I
}
  ? I
  : never

export type TablesUpdate<
  TableName extends keyof DefaultSchema["Tables"]
> = DefaultSchema["Tables"][TableName] extends {
  Update: infer U
}
  ? U
  : never

export type Enums<
  EnumName extends keyof DefaultSchema["Enums"]
> = DefaultSchema["Enums"][EnumName]
