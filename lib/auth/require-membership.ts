import { createSupabaseServerClient } from "../supabase/server";
import type { Capability } from "./permissions";

export async function requireMembership(organisationId:string, capability?:Capability, venueId:string|null=null) {
  const supabase=await createSupabaseServerClient();
  const { data:{user} }=await supabase.auth.getUser();
  if(!user) throw new Error("UNAUTHENTICATED");
  const {data,error}=await supabase.from("organisation_members").select("role").eq("organisation_id",organisationId).eq("user_id",user.id).eq("active",true).single();
  if(error||!data) throw new Error("FORBIDDEN");
  if(capability){
    const {data:allowed,error:capabilityError}=await supabase.rpc("has_capability",{
      target_organisation_id:organisationId,
      target_venue_id:venueId,
      required_capability:capability,
    });
    if(capabilityError||!allowed)throw new Error("FORBIDDEN");
  }
  return {supabase,user,role:data.role};
}
