import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";

const schema=z.object({
  organisationId:z.string().uuid(),
  venueId:z.string().uuid(),
  entries:z.array(z.object({date:z.iso.date(),availability:z.enum(["","available","preferred","preferably_not","unavailable"]),note:z.string().max(300).optional()})).min(1).max(120),
});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const {supabase}=await requireMembership(input.organisationId);
    const {data,error}=await supabase.rpc("set_my_availability" as "clock_out",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_entries:input.entries} as never);
    if(error){
      const message=String(error.message??"");
      const code=message.includes("no_staff_profile")?"NO_STAFF_PROFILE":message.includes("not_assigned_to_venue")?"NOT_ASSIGNED":message.includes("date_out_of_range")?"DATE_OUT_OF_RANGE":"AVAILABILITY_SAVE_FAILED";
      return NextResponse.json({errorCode:code},{status:409});
    }
    return NextResponse.json({message:"Beschikbaarheid opgeslagen.",result:data});
  }catch(error){
    if(error instanceof Error&&error.message==="UNAUTHENTICATED")return NextResponse.json({errorCode:"UNAUTHENTICATED"},{status:401});
    if(error instanceof Error&&error.message==="FORBIDDEN")return NextResponse.json({errorCode:"FORBIDDEN"},{status:403});
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"AVAILABILITY_SAVE_FAILED"},{status:400});
  }
}
