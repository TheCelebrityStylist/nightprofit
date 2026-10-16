import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, securityErrorResponse } from "../../../lib/http/security";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const schema = z.object({
  organisationName: z.string().trim().min(2).max(120),
  venueName: z.string().trim().min(2).max(120),
  venueType: z.enum(["nightclub", "bar", "event_venue"]),
  timezone: z.string().min(3).max(64),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ errorCode: "SESSION_EXPIRED" }, { status: 401 });
    const { data: organisationId, error } = await supabase.rpc("create_organisation", {
      org_name: input.organisationName,
      venue_name: input.venueName,
    });
    if (error || !organisationId) return NextResponse.json({ errorCode: "ORGANISATION_CREATE_FAILED" }, { status: 400 });
    const { data: venue } = await supabase.from("venues").select("id").eq("organisation_id", organisationId).eq("name", input.venueName).single();
    if (venue) await supabase.from("venues").update({ venue_type: input.venueType, timezone: input.timezone }).eq("id", venue.id);
    return NextResponse.json({ redirect: "/app/dashboard" });
  } catch (error) {
    return securityErrorResponse(error) ?? NextResponse.json({ errorCode: error instanceof z.ZodError ? "VALIDATION_FAILED" : "ONBOARDING_FAILED" }, { status: 400 });
  }
}
