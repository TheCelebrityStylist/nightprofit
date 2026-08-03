import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "../../../lib/auth/require-membership";
import { assertSameOrigin, securityErrorResponse } from "../../../lib/http/security";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), organisationId: z.string().uuid(), venueId: z.string().uuid(), serviceDate: z.iso.date() }),
  z.object({ action: z.literal("decide"), organisationId: z.string().uuid(), venueId: z.string().uuid(), serviceOperationId: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(5).max(1000) }),
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
      return NextResponse.json({ operation: data, message: "Serviceplan is opnieuw opgebouwd uit de actuele feiten." }, { status: 201 });
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
