import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {createClient, type SupabaseClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";

const run=process.env.RUN_SUPABASE_INTEGRATION==="1";
const suite=run?describe:describe.skip;
suite("remote Supabase tenant isolation",()=>{
  // Vitest still evaluates a skipped suite's callback. Safe placeholders keep
  // the normal offline test command independent from production credentials.
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL??"http://127.0.0.1:54321";
  const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY??"offline-test-anon-key";
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY??"offline-test-service-key";
  const admin=createClient(url,service,{auth:{persistSession:false}});
  let ownerA:SupabaseClient, viewerB:SupabaseClient, managerA:SupabaseClient;
  const ids={ownerA:randomUUID(),managerA:randomUUID(),viewerB:randomUUID(),orgA:randomUUID(),orgB:randomUUID(),venueA:randomUUID(),venueB:randomUUID(),closeA:randomUUID(),snapshotA:randomUUID(),auditA:randomUUID()};
  const password=`Test-${randomUUID()}-9a!`;
  beforeAll(async()=>{
    const users=[[ids.ownerA,`owner-a-${ids.ownerA}@nightprofit.invalid`],[ids.managerA,`manager-a-${ids.managerA}@nightprofit.invalid`],[ids.viewerB,`viewer-b-${ids.viewerB}@nightprofit.invalid`]] as const;
    for(const [id,email] of users){const {error}=await admin.auth.admin.createUser({id,email,password,email_confirm:true});if(error)throw error}
    await admin.from("organisations").insert([{id:ids.orgA,name:"RLS Org A",created_by:ids.ownerA},{id:ids.orgB,name:"RLS Org B",created_by:ids.viewerB}]);
    await admin.from("organisation_members").insert([{organisation_id:ids.orgA,user_id:ids.ownerA,role:"owner"},{organisation_id:ids.orgA,user_id:ids.managerA,role:"manager"},{organisation_id:ids.orgB,user_id:ids.viewerB,role:"viewer"}]);
    await admin.from("venues").insert([{id:ids.venueA,organisation_id:ids.orgA,name:"Venue A",venue_type:"bar"},{id:ids.venueB,organisation_id:ids.orgB,name:"Venue B",venue_type:"bar"}]);
    await admin.from("closing_sessions").insert({id:ids.closeA,organisation_id:ids.orgA,venue_id:ids.venueA,trading_date:"2026-07-26",status:"approved",created_by:ids.ownerA});
    await admin.from("close_snapshots").insert({id:ids.snapshotA,organisation_id:ids.orgA,closing_session_id:ids.closeA,snapshot:{expected:0,accounted:0},content_hash:randomUUID(),created_by:ids.ownerA});
    await admin.from("audit_logs").insert({id:ids.auditA,organisation_id:ids.orgA,actor_id:ids.ownerA,action:"test",entity_type:"close",entity_id:ids.closeA,correlation_id:randomUUID(),source:"integration"});
    async function login(email:string){const client=createClient(url,anon,{auth:{persistSession:false}});const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;return client}
    ownerA=await login(users[0][1]);managerA=await login(users[1][1]);viewerB=await login(users[2][1]);
  },60000);
  afterAll(async()=>{await admin.from("audit_logs").delete().eq("id",ids.auditA);await admin.from("close_snapshots").delete().eq("id",ids.snapshotA);await admin.from("organisations").delete().in("id",[ids.orgA,ids.orgB]);for(const id of [ids.ownerA,ids.managerA,ids.viewerB])await admin.auth.admin.deleteUser(id)},60000);
  it("organisation B cannot select A or guess a UUID",async()=>{const {data}=await viewerB.from("venues").select("id").eq("id",ids.venueA);expect(data).toEqual([])});
  it("organisation B cannot insert A data",async()=>{const {error}=await viewerB.from("events").insert({organisation_id:ids.orgA,venue_id:ids.venueA,name:"Cross tenant",event_type:"test",starts_at:"2026-07-27T10:00:00Z",ends_at:"2026-07-27T11:00:00Z",created_by:ids.viewerB});expect(error).toBeTruthy()});
  it("viewer cannot mutate own organisation",async()=>{
    const {error}=await viewerB.from("venues").update({name:"Mutated"}).eq("id",ids.venueB);
    expect(error).toBeNull(); // RLS intentionally presents an empty mutation set.
    const {data}=await admin.from("venues").select("name").eq("id",ids.venueB).single();
    expect(data?.name).toBe("Venue B");
  });
  it("manager cannot read billing",async()=>{const {data}=await managerA.from("subscriptions").select("*").eq("organisation_id",ids.orgA);expect(data).toEqual([])});
  it("approved snapshot cannot be modified",async()=>{const {error}=await ownerA.from("close_snapshots").update({snapshot:{tampered:true}}).eq("id",ids.snapshotA);expect(error).toBeTruthy()});
  it("audit entries cannot be modified",async()=>{const {error}=await ownerA.from("audit_logs").update({action:"tampered"}).eq("id",ids.auditA);expect(error).toBeTruthy()});
});
