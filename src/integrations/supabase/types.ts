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
        }
        Insert: {
          id?: string
          user_id: string
          application_id?: string | null
          document_type: string
          file_url: string
          file_name: string
          uploaded_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          application_id?: string | null
          document_type?: string
          file_url?: string
          file_name?: string
          uploaded_at?: string
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
      notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          message: string
          type: string
          read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          message: string
          type?: string
          read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          message?: string
          type?: string
          read?: boolean
          created_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: "admin" | "student"
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
