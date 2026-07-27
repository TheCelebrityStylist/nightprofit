import { createSupabaseServerClient } from "../supabase/server";
import { hasPermission, type Permission } from "./permissions";
import type { MemberRole } from "../supabase/types";

export async function requireMembership(organisationId:string, permission?:Permission) {
  const supabase=await createSupabaseServerClient();
  const { data:{user} }=await supabase.auth.getUser();
  if(!user) throw new Error("UNAUTHENTICATED");
  const {data,error}=await supabase.from("organisation_members").select("role").eq("organisation_id",organisationId).eq("user_id",user.id).single();
  if(error||!data) throw new Error("FORBIDDEN");
  const role=data.role as MemberRole;
  if(permission&&!hasPermission(role,permission)) throw new Error("FORBIDDEN");
  return {supabase,user,role};
}
