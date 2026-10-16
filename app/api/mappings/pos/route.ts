import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
const schema=z.object({organisationId:z.string().uuid(),venueId:z.string().uuid(),sourceValue:z.string().trim().min(1).max(300),menuItemId:z.string().uuid(),confidenceBasisPoints:z.number().int().min(0).max(10000),reasoning:z.string().trim().min(3).max(1000),effectiveFrom:z.iso.date()});
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=schema.parse(await request.json());
    const {supabase}=await requireMembership(input.organisationId,"close.create",input.venueId);
    const {data,error}=await supabase.rpc("confirm_pos_mapping",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_source_value:input.sourceValue,target_menu_item_id:input.menuItemId,target_confidence_basis_points:input.confidenceBasisPoints,target_reasoning:{human_reason:input.reasoning},target_effective_from:input.effectiveFrom});
    if(error)throw error;return NextResponse.json({mapping:data,status:"confirmed"});
  }catch(error){
    const providerError=error&&typeof error==="object"?error as {code?:unknown;message?:unknown}:null;
    console.error("pos_mapping_failed",{
      code:typeof providerError?.code==="string"?providerError.code:error instanceof Error?error.message:"MAPPING_FAILED",
      name:error instanceof Error?error.name:"UnknownError",
    });
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_MAPPING_INPUT":"MAPPING_CONFIRM_FAILED"},{status:400});
  }
}
