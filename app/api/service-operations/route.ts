import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "../../../lib/auth/require-membership";
import { assertSameOrigin, securityErrorResponse } from "../../../lib/http/security";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), organisationId: z.string().uuid(), venueId: z.string().uuid(), serviceDate: z.iso.date() }),
  z.object({ action: z.literal("refresh"), organisationId: z.string().uuid(), venueId: z.string().uuid(), serviceOperationId: z.string().uuid() }),
  z.object({ action: z.literal("decide"), organisationId: z.string().uuid(), venueId: z.string().uuid(), serviceOperationId: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(5).max(1000) }),
  z.object({ action: z.literal("decide_purchase"), organisationId: z.string().uuid(), venueId: z.string().uuid(), planId: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(5).max(1000) }),
]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    const { supabase } = await requireMembership(input.organisationId, "actions.manage", input.venueId);
    if (input.action === "prepare") {
      const { data, error } = await supabase.rpc("prepare_service_operation", {
        target_organisation_id: input.organisationId,
        target_venue_id: input.venueId,
        target_service_date: input.serviceDate,
      });
      if (error) throw error;
      const operation = data as { id?: string } | null;
      if (!operation?.id) throw new Error("service_operation_missing");
      const { data: refreshed, error: refreshError } = await supabase.rpc("refresh_service_intelligence", {
        target_organisation_id: input.organisationId,
        target_service_operation_id: operation.id,
      });
      if (refreshError) throw refreshError;
      return NextResponse.json({ operation: refreshed, message: "Serviceplan is opnieuw opgebouwd uit de actuele feiten." }, { status: 201 });
    }
    if (input.action === "refresh") {
      const { data, error } = await supabase.rpc("refresh_service_intelligence", {
        target_organisation_id: input.organisationId,
        target_service_operation_id: input.serviceOperationId,
      });
      if (error) throw error;
      return NextResponse.json({ operation: data, message: "Live feiten, voorraadbehoefte en inkooprisico zijn bijgewerkt." });
    }
    if (input.action === "decide_purchase") {
      const { data, error } = await supabase.rpc("decide_purchase_plan", {
        target_organisation_id: input.organisationId,
        target_plan_id: input.planId,
        target_decision: input.decision,
        target_reason: input.reason,
      });
      if (error) throw error;
      return NextResponse.json({ plan: data, message: input.decision === "approved" ? "Inkoopvoorstel goedgekeurd. Er is nog niets extern besteld." : "Inkoopvoorstel teruggestuurd." });
    }
    const { data, error } = await supabase.rpc("decide_service_operation", {
      target_organisation_id: input.organisationId,
      target_service_operation_id: input.serviceOperationId,
      target_decision: input.decision,
      target_reason: input.reason,
    });
    if (error) throw error;
    return NextResponse.json({ operation: data, message: input.decision === "approved" ? "Operationeel plan goedgekeurd." : "Plan teruggestuurd voor aanpassing." });
  } catch (error) {
    return securityErrorResponse(error);
  }
}
