import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {assertSameOrigin,consumeRateLimit,opaqueRateLimitKey,securityErrorResponse} from "../../../lib/http/security";
const schema=z.object({organisationId:z.string().uuid(),venueId:z.string().uuid(),tradingDate:z.iso.date()});
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    consumeRateLimit(await opaqueRateLimitKey(request,"reconciliation",`${input.organisationId}:${input.venueId}`),20,15*60_000);
    const {supabase}=await requireMembership(input.organisationId,"reconciliation.run",input.venueId);
    const {data,error}=await supabase.rpc("begin_reconciliation",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_trading_date:input.tradingDate,target_policy_version:"beverage-reconciliation-v2",target_materiality_threshold_minor:"5000"});
    if(error)throw error;return NextResponse.json({run:data});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_RECONCILIATION_INPUT":"RECONCILIATION_FAILED"},{status:400});}
}
