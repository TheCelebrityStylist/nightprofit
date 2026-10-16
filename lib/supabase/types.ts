export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type MemberRole = "owner" | "administrator" | "manager" | "venue_manager" | "bookkeeper" | "finance" | "bookings" | "procurement" | "compliance_manager" | "viewer";
export type RosterEmployeeRow = { id:string; organisation_id:string; full_name:string; phone:string|null; email:string|null; default_role:string; hourly_cost_minor:number; contract_minutes_week:number|null; active:boolean; notes:string|null; created_at:string; updated_at:string };
export type RosterShiftRow = { id:string; organisation_id:string; venue_id:string; service_date:string; employee_id:string|null; role:string; starts_at:string; ends_at:string; break_minutes:number; hourly_cost_minor:number; notes:string|null; status:"scheduled"|"cancelled"; published_version:number|null; changed_since_publish:boolean; created_at:string; updated_at:string };
export type RosterAvailabilityRow = { id:string; organisation_id:string; employee_id:string; service_date:string; status:"available"|"preferred"|"unavailable"; note:string|null; source:"manager"|"whatsapp"|"phone"|"self"; created_at:string; updated_at:string };
export type RosterLeaveRow = { id:string; organisation_id:string; employee_id:string; kind:"leave"|"sick"|"other"; starts_on:string; ends_on:string; status:"requested"|"approved"|"rejected"; note:string|null; decided_by:string|null; decided_at:string|null; created_at:string; updated_at:string };
export type RosterPublicationRow = { id:string; organisation_id:string; venue_id:string; week_start:string; version:number; shift_count:number; open_shift_count:number; paid_minutes:number; labour_cost_minor:number; snapshot:Json; content_hash:string; note:string|null; published_by:string; published_at:string };
export interface Database {
  public: {
    Tables: {
      organisations: { Row: { id:string; name:string; locale:string; currency:string; timezone:string; onboarding_step:number; onboarding_completed_at:string|null; ai_enabled:boolean; stripe_customer_id:string|null }; Insert: { name:string; created_by:string; locale?:string; currency?:string; timezone?:string }; Update: Record<string,unknown>; Relationships: [] };
      organisation_members: { Row: { organisation_id:string; user_id:string; role:MemberRole; venue_ids:string[]|null; approved_closes:boolean }; Insert: { organisation_id:string; user_id:string; role:MemberRole }; Update: Record<string,unknown>; Relationships: [] };
      venues: { Row: { id:string; organisation_id:string; name:string; venue_type:string; timezone:string; trading_cutoff:string }; Insert: { organisation_id:string; name:string; venue_type:string; timezone?:string }; Update: Record<string,unknown>; Relationships: [] };
      closing_sessions: { Row: { id:string; organisation_id:string; venue_id:string; trading_date:string; status:string; expected_total_minor:string; accounted_total_minor:string; difference_minor:string; reopened_reason:string|null }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      closing_lines: { Row: { id:string; organisation_id:string; closing_session_id:string; line_type:string; expected_minor:string; actual_minor:string; quantity:string|null; metadata:Json }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      close_snapshots: { Row: { id:string; organisation_id:string; closing_session_id:string; snapshot:Json; content_hash:string; created_by:string; created_at:string }; Insert: Record<string,unknown>; Update: never; Relationships: [] };
      subscriptions: { Row: { id:string; organisation_id:string; stripe_customer_id:string; stripe_subscription_id:string|null; plan:string; status:string; venue_quantity:number; current_period_end:string|null; cancel_at_period_end:boolean }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      feature_entitlements: { Row: { id:string; organisation_id:string; feature:string; enabled:boolean; source:string; valid_until:string|null }; Insert: { organisation_id:string; feature:string; enabled:boolean; source:string; valid_until?:string|null }; Update: Record<string,unknown>; Relationships: [] };
      stripe_webhook_events: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      audit_logs: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: never; Relationships: [] };
      roster_employees: { Row: RosterEmployeeRow; Insert: { organisation_id:string; full_name:string; phone?:string|null; email?:string|null; default_role?:string; hourly_cost_minor?:number; contract_minutes_week?:number|null; active?:boolean; notes?:string|null }; Update: Partial<Omit<RosterEmployeeRow,"id"|"organisation_id"|"created_at"|"updated_at">>; Relationships: [] };
      roster_shifts: { Row: RosterShiftRow; Insert: { organisation_id:string; venue_id:string; service_date:string; employee_id?:string|null; role?:string; starts_at:string; ends_at:string; break_minutes?:number; hourly_cost_minor?:number; notes?:string|null; status?:"scheduled"|"cancelled" }; Update: Partial<Pick<RosterShiftRow,"service_date"|"employee_id"|"role"|"starts_at"|"ends_at"|"break_minutes"|"hourly_cost_minor"|"notes"|"status">>; Relationships: [] };
      roster_availability: { Row: RosterAvailabilityRow; Insert: { organisation_id:string; employee_id:string; service_date:string; status:RosterAvailabilityRow["status"]; note?:string|null; source?:RosterAvailabilityRow["source"] }; Update: Partial<Pick<RosterAvailabilityRow,"status"|"note"|"source">>; Relationships: [] };
      roster_leave: { Row: RosterLeaveRow; Insert: { organisation_id:string; employee_id:string; kind:RosterLeaveRow["kind"]; starts_on:string; ends_on:string; status?:RosterLeaveRow["status"]; note?:string|null }; Update: Partial<Pick<RosterLeaveRow,"status"|"note"|"starts_on"|"ends_on">>; Relationships: [] };
      roster_publications: { Row: RosterPublicationRow; Insert: never; Update: never; Relationships: [] };
    };
    Views: Record<string,never>;
    Functions: {
      create_organisation: { Args: { org_name:string; venue_name:string }; Returns:string };
      has_capability: { Args: { target_organisation_id:string; target_venue_id:string|null; required_capability:string }; Returns:boolean };
      publish_roster_week: { Args: { target_venue_id:string; target_week_start:string; publish_note?:string|null }; Returns:RosterPublicationRow };
      transition_close: { Args: { target_close_id:string; target_status:string; reason?:string|null }; Returns:Database["public"]["Tables"]["closing_sessions"]["Row"] };
    };
    Enums: { member_role: MemberRole };
    CompositeTypes: Record<string,never>;
  };
}
