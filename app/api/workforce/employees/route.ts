import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {assertSameOrigin,securityErrorResponse} from "../../../../lib/http/security";
import {previewEmployeeCsv} from "../../../../lib/workforce/employee-import";

const previewSchema=z.object({organisationId:z.string().uuid(),venueId:z.string().uuid(),source:z.string().min(1).max(2_000_000)});
const commitSchema=previewSchema.extend({idempotencyKey:z.string().uuid(),decisions:z.record(z.string(),z.enum(["create","reject","skip","merge"]))});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const input=previewSchema.parse(await request.json());
    await requireMembership(input.organisationId,"workforce.manage",input.venueId);
    const preview=previewEmployeeCsv(input.source);
    return NextResponse.json({headers:preview.headers,accepted:preview.accepted.map(row=>({...row,hourlyCostMinor:String(row.hourlyCostMinor)})),rejected:preview.rejected});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"EMPLOYEE_PREVIEW_FAILED"},{status:400})}
}

export async function PUT(request:Request){
  try{
    assertSameOrigin(request);
    const input=commitSchema.parse(await request.json());
    const {supabase}=await requireMembership(input.organisationId,"workforce.manage",input.venueId);
    const preview=previewEmployeeCsv(input.source);
    const rows=preview.accepted.map(row=>({...row,hourlyCostMinor:String(row.hourlyCostMinor),decision:input.decisions[String(row.rowNumber)]??"create"}));
    const {data,error}=await supabase.rpc("import_staff_profiles" as "create_organisation",{target_organisation_id:input.organisationId,target_venue_id:input.venueId,target_rows:rows,target_idempotency_key:input.idempotencyKey} as never);
    if(error)throw error;
    return NextResponse.json({message:"Employee import committed with tenant-scoped duplicate decisions.",result:data,rejected:preview.rejected},{status:201});
  }catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"EMPLOYEE_IMPORT_FAILED"},{status:400})}
}
