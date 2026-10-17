p="app/authenticated-app.tsx"; s=open(p).read()
def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n!=count: raise SystemExit(f"expected {count} got {n}: {old[:80]!r}")
    s=s.replace(old,new)
rep('''    supabase
      .from("departments")
      .select("id,venue_id,name")''','''    supabase
      .from("departments")
      .select("id,venue_id,name,kind")''')
rep('''      .select("id,full_name,role_name,onboarding_status,contact_email,contact_phone,preferred_language,employment_status,invitation_state,effective_hourly_cost_minor,contracted_minutes_week,minimum_minutes_week,maximum_minutes_week,preferences")
      .eq("organisation_id", organisationId)
      .order("full_name"),''','''      .select("id,full_name,role_name,onboarding_status,contact_email,contact_phone,preferred_language,employment_status,invitation_state,effective_hourly_cost_minor,contracted_minutes_week,minimum_minutes_week,maximum_minutes_week,preferences,auth_user_id")
      .eq("organisation_id", organisationId)
      .order("full_name"),''')
rep('''        "id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,revision,locked",
      )
      .eq("organisation_id", organisationId)
      .order("starts_at", { ascending: false })
      .limit(50),''','''        "id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,revision,locked",
      )
      .eq("organisation_id", organisationId)
      .gte("starts_at", new Date(Date.now() - 42 * 86400000).toISOString())
      .lt("starts_at", new Date(Date.now() + 120 * 86400000).toISOString())
      .order("starts_at", { ascending: true })
      .limit(3000),''')
rep('''  if(workforceLearningError)throw workforceLearningError;
  const departments = (departmentData ?? []) as unknown as {
    id: string;
    venue_id: string;
    name: string;
  }[];''','''  if(workforceLearningError)throw workforceLearningError;
  const [{data:servicePatternData},{data:plannerOverrideData},{data:canManageMembers}]=await Promise.all([
    supabase.from("venue_service_patterns" as "departments").select("venue_id,iso_weekday,active,lines").eq("organisation_id",organisationId),
    supabase.from("member_capability_overrides").select("user_id").eq("organisation_id",organisationId).eq("capability","planning.manage").eq("allowed",true),
    supabase.rpc("has_capability",{target_organisation_id:organisationId,target_venue_id:null as unknown as string,required_capability:"members.manage"}),
  ]);
  const servicePatterns=(servicePatternData??[]) as unknown as {venue_id:string;iso_weekday:number;active:boolean;lines:{role_id:string;count:number;start:string;end:string;break_minutes:number}[]}[];
  const plannerUserIds=((plannerOverrideData??[]) as unknown as {user_id:string}[]).map(row=>row.user_id);
  const departments = (departmentData ?? []) as unknown as {
    id: string;
    venue_id: string;
    name: string;
    kind?: "staff" | "dj";
  }[];''')
rep('''      proposals={proposals}
    />
  );
  /* The legacy form workspace''','''      proposals={proposals}
      servicePatterns={servicePatterns}
      plannerUserIds={plannerUserIds}
      canManageMembers={Boolean(canManageMembers)}
    />
  );
  /* The legacy form workspace''')
rep('''    preferences: Record<string,unknown>;
  }[];
  const intervals''','''    preferences: Record<string,unknown>;
    auth_user_id: string | null;
  }[];
  const intervals''')
open(p,"w").write(s); print("aa ok")
