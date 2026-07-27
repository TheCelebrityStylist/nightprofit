export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type MemberRole = "owner" | "administrator" | "manager" | "bookkeeper" | "viewer";
export interface Database {
  public: {
    Tables: {
      organisations: { Row: { id:string; name:string; locale:string; currency:string; timezone:string; onboarding_step:number; onboarding_completed_at:string|null; ai_enabled:boolean; stripe_customer_id:string|null }; Insert: { name:string; created_by:string; locale?:string; currency?:string; timezone?:string }; Update: Record<string,unknown>; Relationships: [] };
      organisation_members: { Row: { organisation_id:string; user_id:string; role:MemberRole; venue_ids:string[]|null; approved_closes:boolean }; Insert: { organisation_id:string; user_id:string; role:MemberRole }; Update: Record<string,unknown>; Relationships: [] };
      venues: { Row: { id:string; organisation_id:string; name:string; venue_type:string; timezone:string; trading_cutoff:string }; Insert: { organisation_id:string; name:string; venue_type:string; timezone?:string }; Update: Record<string,unknown>; Relationships: [] };
      closing_sessions: { Row: { id:string; organisation_id:string; venue_id:string; trading_date:string; status:string; expected_total_minor:number; accounted_total_minor:number; difference_minor:number; reopened_reason:string|null }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      subscriptions: { Row: { id:string; organisation_id:string; stripe_customer_id:string; stripe_subscription_id:string|null; plan:string; status:string; venue_quantity:number; current_period_end:string|null; cancel_at_period_end:boolean }; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      feature_entitlements: { Row: { id:string; organisation_id:string; feature:string; enabled:boolean; source:string; valid_until:string|null }; Insert: { organisation_id:string; feature:string; enabled:boolean; source:string; valid_until?:string|null }; Update: Record<string,unknown>; Relationships: [] };
      stripe_webhook_events: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: Record<string,unknown>; Relationships: [] };
      audit_logs: { Row: Record<string,unknown>; Insert: Record<string,unknown>; Update: never; Relationships: [] };
    };
    Views: Record<string,never>;
    Functions: { create_organisation: { Args: { org_name:string; venue_name:string }; Returns:string } };
    Enums: { member_role: MemberRole };
    CompositeTypes: Record<string,never>;
  };
}
