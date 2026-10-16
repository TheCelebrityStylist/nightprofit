import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
const schema=z.object({organisationId:z.string().uuid(),venueId:z.string().uuid(),tradingDate:z.iso.date(),reconciliationId:z.string().uuid()});
export async function POST(request:Request){
  try{assertSameOrigin(request);const input=schema.parse(await request.json());const {supabase}=await requireMembership(input.organisationId,"close.create",input.venueId);const {data,error}=await supabase.rpc("prepare_reconciliation_close",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_trading_date:input.tradingDate,target_reconciliation_id:input.reconciliationId});if(error)throw error;return NextResponse.json({close:data});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_PRECLOSE_INPUT":"PRECLOSE_BLOCKED"},{status:400});}
}
