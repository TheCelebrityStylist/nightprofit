import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { assertSameOrigin, securityErrorResponse } from "../../../../lib/http/security";
export async function POST(request:Request){try{assertSameOrigin(request);const supabase=await createSupabaseServerClient();await supabase.auth.signOut({scope:"local"});return NextResponse.json({redirect:"/login"})}catch(error){return securityErrorResponse(error)??NextResponse.json({errorCode:"SIGN_OUT_FAILED"},{status:400})}}
