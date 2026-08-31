import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../../lib/auth/require-membership";
import {securityErrorResponse} from "../../../../lib/http/security";

const querySchema=z.object({
  organisationId:z.string().uuid(),
  venueId:z.string().uuid(),
  startsAt:z.iso.datetime(),
  endsAt:z.iso.datetime(),
});

type QueueRow={
  action_key:string;
  action_type:string;
  severity:string;
  rank_score:number|string;
  due_at:string|null;
  title:string;
  rationale:string;
  evidence_refs:unknown;
  shift_id:string|null;
  staff_id:string|null;
  related_id:string|null;
};

type LearningRow={
  id:string;
  service_date:string;
  comparison_basis:Record<string,unknown>;
  lessons:unknown;
  evidence_refs:Record<string,unknown>;
  calculation_version:string;
  content_hash:string;
  created_at:string;
};

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const input=querySchema.parse(Object.fromEntries(url.searchParams));
    if(new Date(input.endsAt)<=new Date(input.startsAt))throw new Error("INVALID_WINDOW");
    const {supabase}=await requireMembership(input.organisationId,"planning.manage",input.venueId);
    const {data:queueData,error:queueError}=await supabase.rpc("get_workforce_exception_queue" as never,{
      target_organisation_id:input.organisationId,
      target_venue_id:input.venueId,
      target_window_start:input.startsAt,
      target_window_end:input.endsAt,
    } as never);
    if(queueError)throw queueError;

    const startDate=input.startsAt.slice(0,10),endDate=input.endsAt.slice(0,10);
    const learningQuery=supabase.from("workforce_learning_results" as never) as unknown as {
      select:(columns:string)=>{
        eq:(column:string,value:string)=>{
          eq:(column:string,value:string)=>{
            gte:(column:string,value:string)=>{
              lt:(column:string,value:string)=>{
                order:(column:string,options:{ascending:boolean})=>{
                  limit:(count:number)=>Promise<{data:unknown[]|null;error:unknown}>
                }
              }
            }
          }
        }
      }
    };
    const {data:learningData,error:learningError}=await learningQuery
      .select("id,service_date,comparison_basis,lessons,evidence_refs,calculation_version,content_hash,created_at")
      .eq("organisation_id",input.organisationId)
      .eq("venue_id",input.venueId)
      .gte("service_date",startDate)
      .lt("service_date",endDate)
      .order("created_at",{ascending:false})
      .limit(8);
    if(learningError)throw learningError;

    return NextResponse.json({
      queue:(queueData??[]) as QueueRow[],
      learning:(learningData??[]) as LearningRow[],
      window:{startsAt:input.startsAt,endsAt:input.endsAt},
    });
  }catch(error){
    return securityErrorResponse(error)??NextResponse.json({errorCode:error instanceof z.ZodError?"VALIDATION_FAILED":"WORKFORCE_QUEUE_FAILED"},{status:400});
  }
}
