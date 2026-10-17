p="app/authenticated-app.tsx"; s=open(p).read()
def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n!=count: raise SystemExit(f"expected {count} got {n}: {old[:80]!r}")
    s=s.replace(old,new)
rep('import { RosterBoard } from "./roster-board";','import { RosterBoard } from "./roster-board";\nimport { MyRoster } from "./my-roster";')
rep('''  const next = shifts[0];
  return (
    <div className="workflow-stack employee-work">
      <section className="morning-brief">
        <div>
          <div className="eyebrow">{t("myWork.eyebrow")} · {staff.full_name}</div>
          <h2>
            {next
              ? `${t("myWork.nextShift")} ${new Date(next.starts_at).toLocaleString(authIntlLocale(locale), { weekday: "long", hour: "2-digit", minute: "2-digit" })}`
              : t("myWork.noNextShift")}
          </h2>
          <p>{t("myWork.privateHelp")}</p>
        </div>
        <span className="status">
          {openRecord ? t("myWork.clockedIn") : t("myWork.notClockedIn")}
        </span>
      </section>''','''  const next = shifts[0];
  const rosterMonday=new Date();rosterMonday.setHours(0,0,0,0);rosterMonday.setDate(rosterMonday.getDate()-((rosterMonday.getDay()+6)%7));
  const rosterEnd=new Date(rosterMonday.getTime()+35*86400000);
  const myVenue=venues[0];
  const [{data:myRosterData},{data:myAvailabilityData},{data:myPatternData}]=await Promise.all([
    supabase.rpc("get_my_roster" as "clock_out",{target_organisation_id:organisationId,target_from:rosterMonday.toISOString(),target_to:rosterEnd.toISOString()} as never),
    supabase.from("staff_availability").select("starts_at,availability").eq("organisation_id",organisationId).eq("staff_id",staff.id).gte("starts_at",new Date(rosterMonday.getTime()-86400000).toISOString()).lt("starts_at",rosterEnd.toISOString()).order("starts_at").order("created_at"),
    supabase.from("venue_service_patterns" as "departments").select("venue_id,iso_weekday,active").eq("organisation_id",organisationId),
  ]);
  const myRoster=(myRosterData??{shifts:[]}) as unknown as {shifts:{id:string;venue_id:string;starts_at:string;ends_at:string;break_minutes:number;status:string;role_name:string;department_kind:string;colleagues:{name:string;role_name:string;starts_at:string;ends_at:string}[]}[]};
  const openWeekdays=((myPatternData??[]) as unknown as {venue_id:string;iso_weekday:number;active:boolean}[]).filter(row=>row.active&&(!myVenue||row.venue_id===myVenue.id)).map(row=>row.iso_weekday);
  return (
    <div className="workflow-stack employee-work">
      {myVenue?<MyRoster organisationId={organisationId} venueId={myVenue.id} venueName={myVenue.name} timezone={myVenue.timezone||"Europe/Amsterdam"} firstName={staff.full_name.trim().split(/\\s+/)[0]} shifts={myRoster.shifts??[]} availability={(myAvailabilityData??[]) as unknown as {starts_at:string;availability:string}[]} openWeekdays={openWeekdays} locale={locale==="nl"?"nl":"en"}/>:null}
      {openRecord?<p className="my-clock-state">{t("myWork.clockedIn")}</p>:null}''')
open(p,"w").write(s); print("aa3 ok")
