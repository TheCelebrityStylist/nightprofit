import {NextResponse} from "next/server";
import {z} from "zod";
import {requireMembership} from "../../../lib/auth/require-membership";
import {createAvailabilityToken,hashAvailabilityToken} from "../../../lib/workforce/availability";

const schema=z.object({
  organisationId:z.string().uuid(),venueId:z.string().uuid(),
  startsAt:z.iso.datetime({local:true}),endsAt:z.iso.datetime({local:true}),deadlineAt:z.iso.datetime({local:true}),
  staffIds:z.array(z.string().uuid()).min(1).max(250),
});

export async function POST(request:Request){
  try{
    const input=schema.parse(await request.json());
    const {supabase}=await requireMembership(input.organisationId,"workforce.manage",input.venueId);
    const origin=new URL(request.url).origin;
    const {data:staff,error:staffError}=await supabase.from("staff_profiles").select("id,preferred_language").eq("organisation_id",input.organisationId).in("id",input.staffIds);
    if(staffError||staff?.length!==input.staffIds.length)throw new Error("RECIPIENTS_INVALID");
    const links=new Map<string,string>();
    const recipients=(staff as unknown as {id:string;preferred_language:string}[]).map(person=>{
      const token=createAvailabilityToken();
      const responseUrl=`${origin}/availability/${token}`;
      links.set(person.id,responseUrl);
      return {staff_id:person.id,token_hash:hashAvailabilityToken(token),response_url:responseUrl,language:person.preferred_language};
    });
    const {data,error}=await supabase.rpc("create_availability_request",{
      target_organisation_id:input.organisationId,target_venue_id:input.venueId,
      target_starts_at:new Date(input.startsAt).toISOString(),target_ends_at:new Date(input.endsAt).toISOString(),
      target_deadline_at:new Date(input.deadlineAt).toISOString(),recipient_inputs:recipients,
    });
    if(error)throw error;
    return NextResponse.json({message:`Beschikbaarheid gevraagd aan ${recipients.length} medewerker(s).`,requestId:data,links:Object.fromEntries(links)},{status:201});
  }catch(error){
    return NextResponse.json({error:error instanceof z.ZodError?"Controleer periode, deadline en ontvangers.":"De beschikbaarheidsaanvraag kon niet veilig worden gemaakt."},{status:400});
  }
}
