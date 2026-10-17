import sys
path=sys.argv[1]; src=open(path,encoding="utf-8").read()
def rep(old,new,count=1):
    global src
    n=src.count(old)
    if n!=count: raise SystemExit(f"expected {count} got {n}: {old[:90]!r}")
    src=src.replace(old,new)
rep('''  async function workforceMutate(''','''  async function applyStandardWeek(){
    setBusy(true);setMessage("");
    try{
      const local=`${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,"0")}-${String(weekStart.getDate()).padStart(2,"0")}`;
      const response=await fetch("/api/planning/nights",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organisationId,action:"week_apply",values:{venueId,weekStart:local}})});
      const result=await response.json() as {message?:string;errorCode?:string};
      if(!response.ok)throw new Error(result.errorCode==="FORBIDDEN"?tx("Je hebt geen planningsrechten.","You don't have planning rights."):tx("Standaardweek invullen mislukt.","Filling the standard week failed."));
      setMessage(result.message??tx("Standaardweek ingevuld.","Standard week filled."));router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:tx("Mislukt.","Failed."))}finally{setBusy(false)}
  }
  async function workforceMutate(''')
rep('''<button type="button" className="primary" disabled={busy} onClick={()=>setPanel("nights")}>{tx(`Standaardweek invullen (${standardMissing})`''','''<button type="button" className="primary" disabled={busy} onClick={()=>void applyStandardWeek()}>{tx(`Standaardweek invullen (${standardMissing})`''')
p=path
old="  const respondedStaff = new Set(weekAvailability.map((row) => row.staff_id)).size;\n"
rep(old,"")
open(path,"w",encoding="utf-8").write(src); print("ok5+6")
