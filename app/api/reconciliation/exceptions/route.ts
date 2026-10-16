import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
const schema=z.object({organisationId:z.string().uuid(),venueId:z.string().uuid(),exceptionId:z.string().uuid(),action:z.enum(["investigate","request_recount","correct_mapping","add_delivery","record_waste","record_breakage","record_complimentary","create_correction","accept_within_tolerance","escalate","resolve","reopen"]),reason:z.string().trim().min(5).max(2000),idempotencyKey:z.string().uuid()});
export async function POST(request:Request){
  try{assertSameOrigin(request);const input=schema.parse(await request.json());const {supabase}=await requireMembership(input.organisationId,"reconciliation.run",input.venueId);const {data,error}=await supabase.rpc("decide_reconciliation_exception",{target_organisation_id:input.organisationId,target_exception_id:input.exceptionId,target_action:input.action,target_reason:input.reason,target_idempotency_key:input.idempotencyKey,target_evidence:[]});if(error)throw error;return NextResponse.json({exception:data});}
  catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_EXCEPTION_DECISION":"EXCEPTION_DECISION_FAILED"},{status:400});}
}
