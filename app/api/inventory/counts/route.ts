import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
const line=z.object({product_id:z.string().uuid(),packages:z.string().regex(/^\d+(\.\d{1,6})?$/),complete_units:z.string().regex(/^\d+(\.\d{1,6})?$/),partial_basis_points:z.number().int().min(0).max(10000)});
const create=z.object({action:z.literal("create"),organisationId:z.string().uuid(),venueId:z.string().uuid(),locationId:z.string().uuid(),tradingDate:z.iso.date(),countType:z.enum(["opening","closing","delivery_verification","spot_check","full_location"]),countedAt:z.iso.datetime(),notes:z.string().max(1000).default(""),idempotencyKey:z.string().uuid(),lines:z.array(line).min(1).max(500)});
const transition=z.object({action:z.enum(["submit","post"]),organisationId:z.string().uuid(),venueId:z.string().uuid(),countId:z.string().uuid(),idempotencyKey:z.string().uuid()});
const movement=z.object({action:z.literal("movement"),organisationId:z.string().uuid(),venueId:z.string().uuid(),locationId:z.string().uuid(),productId:z.string().uuid(),tradingDate:z.iso.date(),movementType:z.enum(["receipt","supplier_return","transfer_in","transfer_out","waste","breakage","complimentary","staff_consumption","sampling","preparation","approved_correction"]),quantity:z.string().regex(/^-?\d+(\.\d{1,6})?$/).refine(value=>!/^[-+]?0(?:\.0+)?$/.test(value)),sourceId:z.string().uuid(),idempotencyKey:z.string().uuid(),note:z.string().trim().min(3).max(1000),correctionOfId:z.string().uuid().nullable().default(null)})
  .refine(value=>value.movementType==="approved_correction"||!value.quantity.startsWith("-"),{message:"NEGATIVE_MOVEMENT_FORBIDDEN",path:["quantity"]})
  .refine(value=>value.movementType!=="approved_correction"||value.correctionOfId!==null,{message:"CORRECTION_REFERENCE_REQUIRED",path:["correctionOfId"]});
const inputSchema=z.discriminatedUnion("action",[create,transition,movement]);
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=inputSchema.parse(await request.json());
    if(input.action==="create"){
      const {supabase}=await requireMembership(input.organisationId,"inventory.count",input.venueId);
      const {data,error}=await supabase.rpc("create_stock_count",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_location_id:input.locationId,target_trading_date:input.tradingDate,target_count_type:input.countType,target_counted_at:input.countedAt,target_notes:input.notes,target_idempotency_key:input.idempotencyKey,line_inputs:input.lines});
      if(error)throw error;return NextResponse.json({countId:data,status:"draft"},{status:201});
    }
    if(input.action==="movement"){
      const {supabase}=await requireMembership(input.organisationId,"inventory.post",input.venueId);
      const {data,error}=await supabase.rpc("record_stock_movement",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_location_id:input.locationId,target_product_id:input.productId,target_trading_date:input.tradingDate,target_movement_type:input.movementType,target_quantity:input.quantity,target_source_type:"manager_entry",target_source_id:input.sourceId,target_idempotency_key:input.idempotencyKey,target_evidence:{note:input.note},target_correction_of_id:input.correctionOfId});
      if(error)throw error;return NextResponse.json({movement:data,status:"posted"},{status:201});
    }
    const capability=input.action==="post"?"inventory.post":"inventory.count";
    const {supabase}=await requireMembership(input.organisationId,capability,input.venueId);
    const result=input.action==="post"?await supabase.rpc("post_stock_count",{target_organisation_id:input.organisationId,target_count_id:input.countId,target_idempotency_key:input.idempotencyKey}):await supabase.rpc("submit_stock_count",{target_organisation_id:input.organisationId,target_count_id:input.countId});
    if(result.error)throw result.error;return NextResponse.json({count:result.data,status:input.action==="post"?"posted":"submitted"});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"INVALID_INVENTORY_INPUT":"INVENTORY_MUTATION_FAILED"},{status:400});}
}
