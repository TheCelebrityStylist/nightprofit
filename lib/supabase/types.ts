export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type MemberRole = "owner" | "administrator" | "manager" | "venue_manager" | "bookkeeper" | "finance" | "bookings" | "procurement" | "compliance_manager" | "viewer";
export interface Database {
  public: {
    Tables: {
      organisations: { Row: { id:string; name:string; locale:string; currency:string; timezone:string; onboarding_step:number; onboarding_completed_at:string|null; ai_enabled:boolean; stripe_customer_id:string|null }; Insert: { name:string; created_by:string; locale?:string; currency?:string; timezone?:string }; Update: Record<string,unknown>; Relationships: [] };
      organisation_members: { Row: { organisation_id:string; user_id:string; role:MemberRole; venue_ids:string[]|null; approved_closes:boolean }; Insert: { organisation_id:string; user_id:string; role:MemberRole }; Update: Record<string,unknown>; Relationships: [] };
      venues: { Row: { id:string; organisation_id:string; name:string; venue_type:string; timezone:string; trading_cutoff:string }; Insert: { organisation_id:string; name:string; venue_type:string; timezone?:string }; Update: Record<string,unknown>; Relationships: [] };
      closing_sessions: { Row: { id:string; organisation_id:string; venue_id:string; trading_date:string; status:string; version:number; expected_total_minor:string; accounted_total_minor:string; difference_minor:string; reopened_reason:string|null }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      closing_lines: { Row: { id:string; organisation_id:string; closing_session_id:string; line_type:string; expected_minor:string; actual_minor:string; quantity:string|null; metadata:Json }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      close_snapshots: { Row: { id:string; organisation_id:string; closing_session_id:string; snapshot:Json; content_hash:string; created_by:string; created_at:string }; Insert: Record<string,unknown>; Update: never; Relationships: [] };
      subscriptions: { Row: { id:string; organisation_id:string; stripe_customer_id:string; stripe_subscription_id:string|null; plan:string; status:string; venue_quantity:number; current_period_end:string|null; cancel_at_period_end:boolean }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      feature_entitlements: { Row: { id:string; organisation_id:string; feature:string; enabled:boolean; source:string; valid_until:string|null }; Insert: { organisation_id:string; feature:string; enabled:boolean; source:string; valid_until?:string|null }; Update: Record<string,unknown>; Relationships: [] };
      stripe_webhook_events: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      audit_logs: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: never; Relationships: [] };
      suppliers: { Row: { id:string;organisation_id:string;name:string;vat_number:string|null;email:string|null;created_at:string;updated_at:string }; Insert: { organisation_id:string;name:string;vat_number?:string|null;email?:string|null }; Update: Record<string,unknown>; Relationships: [] };
      booking_inquiries: { Row: { id:string;organisation_id:string;venue_id:string;status:string;source:string;preferred_start:string;flexible:boolean;group_size:number;occasion:string|null;budget_minor:string|null;package_interest:string|null;preferences:Json;accessibility_notes:string|null;contact_name:string;contact_email:string;contact_phone:string|null;consent_at:string|null;assigned_to:string|null;created_at:string;updated_at:string }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      events: { Row: { id:string;organisation_id:string;venue_id:string;name:string;concept:string|null;event_type:string;starts_at:string;ends_at:string;expected_attendance:number|null;actual_attendance:number|null;notes:string|null;created_by:string;created_at:string;updated_at:string }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      event_yield_scenarios: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: never; Relationships: [] };
      supplier_contracts: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      contract_discrepancies: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      staff_profiles: { Row: { id:string;organisation_id:string;auth_user_id:string|null;full_name:string;contact_email:string|null;contact_phone:string|null;preferred_language:string;engagement_type:string;role_name:string;start_date:string|null;end_date:string|null;onboarding_status:string;created_at:string;updated_at:string }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      staff_incidents: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      compliance_policies: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: never; Relationships: [] };
      booking_deposits: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      booking_quotes: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: never; Relationships: [] };
      profit_recovery_ledger: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      integration_connections: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      demand_forecasts: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      staff_availability: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      staff_shifts: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      time_records: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      operating_actions: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
    };
    Views: Record<string,never>;
    Functions: {
      create_organisation: { Args: { org_name:string; venue_name:string }; Returns:string };
      has_capability: { Args: { target_organisation_id:string; target_venue_id:string|null; required_capability:string }; Returns:boolean };
      transition_close: { Args: { target_close_id:string; target_status:string; reason?:string|null }; Returns:Database["public"]["Tables"]["closing_sessions"]["Row"] };
    };
    Enums: { member_role: MemberRole };
    CompositeTypes: Record<string,never>;
  };
}
