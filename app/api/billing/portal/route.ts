import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "../../../../lib/auth/require-membership";
import { assertSameOrigin, securityErrorResponse } from "../../../../lib/http/security";
import { stripeClient } from "../../../../lib/stripe/server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { organisationId } = z.object({ organisationId: z.uuid() }).parse(await request.json());
    const { supabase } = await requireMembership(organisationId, "billing.manage");
    const { data } = await supabase.from("organisations").select("stripe_customer_id").eq("id", organisationId).single();
    if (!data?.stripe_customer_id) return NextResponse.json({ errorCode: "STRIPE_CUSTOMER_MISSING" }, { status: 400 });
    const origin = new URL(request.url).origin;
    const session = await stripeClient().billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: `${origin}/app/settings/billing` });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return securityErrorResponse(error) ?? NextResponse.json({ errorCode: "PORTAL_FAILED" }, { status: 403 });
  }
}
