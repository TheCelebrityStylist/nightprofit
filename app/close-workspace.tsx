"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const lineTypes = [
  ["pos_sales", "POS omzet"], ["terminal", "Pin/terminal"], ["cash", "Contant"],
  ["online_tickets", "Online tickets"], ["booking_deposit", "Boekingsdeposito"],
  ["refund", "Terugbetaling"], ["tips", "Fooien"], ["safe_drop", "Kluisafdracht"],
  ["manual_correction", "Correctie"],
] as const;

export function CloseWorkspace({
  organisationId,
  closeId,
  status,
  canApprove,
  canReopen,
}: {
  organisationId: string;
  closeId: string;
  status: string;
  canApprove: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function addLine(formData: FormData) {
    setPending(true); setError("");
    const response = await fetch(`/api/closes/${closeId}/lines`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId, lineType: formData.get("lineType"),
        expected: formData.get("expected"), actual: formData.get("actual"),
        metadata: { note: String(formData.get("note") ?? "") },
      }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) { setError(result.error ?? "Regel kon niet worden opgeslagen."); return; }
    router.refresh();
  }

  async function transition(target: string, reason?: string) {
    setPending(true); setError("");
    const response = await fetch(`/api/closes/${closeId}/transition`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, reason: reason || null }),
    });
    const result = (await response.json()) as { error?: string; close?: { id: string } };
    setPending(false);
    if (!response.ok) { setError(result.error ?? "Statuswijziging is niet toegestaan."); return; }
    if (target === "reopened" && result.close?.id) router.push(`/app/close/${result.close.id}`);
    else router.refresh();
  }

  const editable = status === "draft" || status === "reopened";
  return <div className="workflow-stack">
    {editable && <form className="workflow-card" action={addLine}>
      <h3>Bedragregel toevoegen</h3>
      <div className="workflow-fields three">
        <label>Type<select name="lineType" required>{lineTypes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Verwacht (€)<input name="expected" inputMode="decimal" required placeholder="0,00"/></label>
        <label>Werkelijk (€)<input name="actual" inputMode="decimal" required placeholder="0,00"/></label>
      </div>
      <label>Toelichting<input name="note" maxLength={300}/></label>
      <button className="primary" disabled={pending}>Regel opslaan</button>
    </form>}
    <div className="action-bar">
      {editable && <button className="primary" disabled={pending} onClick={()=>transition("submitted")}>Indienen</button>}
      {status === "submitted" && canApprove && <button className="primary" disabled={pending} onClick={()=>transition("approved")}>Goedkeuren</button>}
      {status === "approved" && canApprove && <button className="ghost" disabled={pending} onClick={()=>transition("locked")}>Vergrendelen</button>}
      {(status === "approved" || status === "locked") && canReopen && <ReopenButton disabled={pending} onReopen={(reason)=>transition("reopened",reason)}/>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

function ReopenButton({disabled,onReopen}:{disabled:boolean;onReopen:(reason:string)=>void}) {
  const [reason,setReason]=useState("");
  return <div className="reopen-control">
    <input aria-label="Reden voor heropening" value={reason} onChange={(event)=>setReason(event.target.value)} placeholder="Verplichte reden (min. 10 tekens)"/>
    <button className="ghost" disabled={disabled || reason.trim().length < 10} onClick={()=>onReopen(reason)}>Nieuwe versie maken</button>
  </div>;
}
