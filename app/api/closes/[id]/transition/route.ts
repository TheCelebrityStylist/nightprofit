import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

const schema=z.object({target:z.enum(["submitted","approved","locked","reopened"]),reason:z.string().trim().max(2000).nullable().optional()});

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;
    const input=schema.parse(await request.json());
    const supabase=await createSupabaseServerClient();
    const {data,error}=await supabase.rpc("transition_close",{target_close_id:id,target_status:input.target,reason:input.reason??null});
    if(error||!data)return NextResponse.json({error:"Overgang is niet toegestaan."},{status:403});
    return NextResponse.json({close:data});
  }catch{return NextResponse.json({error:"Ongeldige overgang."},{status:400});}
}
