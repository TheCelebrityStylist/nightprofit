p="app/authenticated-app.tsx"; s=open(p).read()
def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n!=count: raise SystemExit(f"expected {count} got {n}: {old[:80]!r}")
    s=s.replace(old,new)

# --- paging helper: PostgREST caps a response at 1000 rows -------------------
rep('''async function planning(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,''','''/** Loads every row of a query in 1000-row pages (the API caps a single response). */
async function fetchAllRows<T>(page:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>,maximum=25000){
  const rows:T[]=[];
  for(let from=0;from<maximum;from+=1000){
    const {data,error}=await page(from,from+999);
    if(error)throw error;
    rows.push(...(data??[]));
    if(!data||data.length<1000)break;
  }
  return {data:rows};
}
const planningWindow=()=>({from:new Date(Date.now()-183*86400000).toISOString(),to:new Date(Date.now()+400*86400000).toISOString()});

async function planning(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,''')
rep('''    supabase
      .from("current_demand_forecast_intervals" as "demand_forecast_intervals")
      .select(
        "id,venue_id,starts_at,ends_at,expected_guests,expected_revenue_minor,required_staff",
      )
      .eq("organisation_id", organisationId)
      .order("starts_at", { ascending: false })
      .limit(30),''','''    fetchAllRows((from,to)=>supabase
      .from("current_demand_forecast_intervals" as "demand_forecast_intervals")
      .select(
        "id,venue_id,starts_at,ends_at,expected_guests,expected_revenue_minor,required_staff",
      )
      .eq("organisation_id", organisationId)
      .gte("starts_at", planningWindow().from)
      .lt("starts_at", planningWindow().to)
      .order("starts_at")
      .range(from,to)),''')
rep('''    supabase
      .from("shifts")
      .select(
        "id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,revision,locked",
      )
      .eq("organisation_id", organisationId)
      .gte("starts_at", new Date(Date.now() - 42 * 86400000).toISOString())
      .lt("starts_at", new Date(Date.now() + 120 * 86400000).toISOString())
      .order("starts_at", { ascending: true })
      .limit(3000),''','''    fetchAllRows((from,to)=>supabase
      .from("shifts")
      .select(
        "id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,revision,locked",
      )
      .eq("organisation_id", organisationId)
      .gte("starts_at", planningWindow().from)
      .lt("starts_at", planningWindow().to)
      .order("starts_at", { ascending: true })
      .order("id")
      .range(from,to)),''')
rep('''    supabase
      .from("staff_absences")
      .select("id,venue_id,staff_id,starts_at,ends_at,absence_type,status,note")
      .eq("organisation_id", organisationId)
      .order("starts_at", { ascending: false })
      .limit(200),
    supabase
      .from("staff_availability")
      .select("staff_id,venue_id,starts_at,ends_at,availability,submitted_at,source")
      .eq("organisation_id", organisationId)
      .order("starts_at", { ascending: false })
      .limit(500),''','''    fetchAllRows((from,to)=>supabase
      .from("staff_absences")
      .select("id,venue_id,staff_id,starts_at,ends_at,absence_type,status,note")
      .eq("organisation_id", organisationId)
      .gte("ends_at", planningWindow().from)
      .order("starts_at")
      .order("id")
      .range(from,to)),
    fetchAllRows((from,to)=>supabase
      .from("staff_availability")
      .select("staff_id,venue_id,starts_at,ends_at,availability,submitted_at,source")
      .eq("organisation_id", organisationId)
      .gte("starts_at", planningWindow().from)
      .lt("starts_at", planningWindow().to)
      .order("starts_at")
      .order("id")
      .range(from,to)),''')

# --- role-aware shell: team members get their own roster, planners get both ---
rep('''  const venues = (venuesData ?? []) as Venue[];
  const closes = (closesData ?? []) as Close[];''','''  const venues = (venuesData ?? []) as Venue[];
  const closes = (closesData ?? []) as Close[];
  const [{data:canPlanData},{data:ownProfile}]=await Promise.all([
    supabase.rpc("has_capability",{target_organisation_id:organisationId,target_venue_id:null as unknown as string,required_capability:"planning.manage"}),
    supabase.from("staff_profiles").select("id").eq("organisation_id",organisationId).eq("auth_user_id",user.id).maybeSingle(),
  ]);
  const canPlan=Boolean(canPlanData);
  const fullAccess=["owner","administrator","manager","venue_manager","finance","bookkeeper"].includes(String(membership.role));
  const teamOnly=!fullAccess;
  const navItems:readonly (readonly [AuthMessageKey,string])[]=teamOnly
    ?[["nav.myRoster","/app/my-work"],...(canPlan?[["nav.planning","/app/planning"] as const]:[])]
    :[...navigation,...(ownProfile?[["nav.myRoster","/app/my-work"] as const]:[])];
  const path=teamOnly&&requestedPath!=="/app/my-work"&&!(canPlan&&requestedPath==="/app/planning")?"/app/my-work":requestedPath;''')
rep('''    navigation.find(([, href]) => path === href)?.[0] ??''','''    navItems.find(([, href]) => path === href)?.[0] ??''')
rep('''          {navigation.map(([key, href]) => (''','''          {navItems.map(([key, href]) => (''')
rep('''          {path !== "/app/planning" && <section className="hero-row">''','''          {path !== "/app/planning" && path !== "/app/my-work" && <section className="hero-row">''')
rep('''async function AuthenticatedAppContent({
  path,
  locale,
}: {''','''async function AuthenticatedAppContent({
  path: requestedPath,
  locale,
}: {''')
open(p,"w").write(s); print("aa2 ok")
