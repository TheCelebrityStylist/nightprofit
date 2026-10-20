import {NextResponse} from "next/server";
import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
import {createSupabaseAdminClient} from "../../../../lib/supabase/admin";
import {sendReminders} from "../../../../lib/workforce/reminders";

// "Herinner nu": the planner nudges everyone who has not answered this request yet.
const schema=z.object({organisationId:z.string().uuid(),venueId:z.string().uuid(),requestId:z.string().uuid()});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const {user}=await requireMembership(input.organisationId,"workforce.manage",input.venueId);
    const result=await sendReminders(createSupabaseAdminClient() as unknown as SupabaseClient,{origin:new URL(request.url).origin,mode:"manual",organisationId:input.organisationId,venueId:input.venueId,requestId:input.requestId,actorId:user.id});
    return NextResponse.json({sent:result.sent,outcomes:result.outcomes.map(row=>({staffId:row.staffId,name:row.name,state:row.state,detail:row.detail,whatsappUrl:row.whatsappUrl}))});
  }catch(error){
    if(error instanceof Error&&error.message==="UNAUTHENTICATED")return NextResponse.json({errorCode:"UNAUTHENTICATED"},{status:401});
    if(error instanceof Error&&error.message==="FORBIDDEN")return NextResponse.json({errorCode:"FORBIDDEN"},{status:403});
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"REMINDERS_FAILED"},{status:400});
  }
}
