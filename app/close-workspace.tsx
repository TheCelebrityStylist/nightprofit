"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthLocale } from "./auth-locale";
import type { AuthMessageKey } from "../lib/i18n/authenticated";

const lineTypes = [
  ["pos_sales", "close.line.posSales"], ["terminal", "close.line.terminal"], ["cash", "close.line.cash"],
  ["online_tickets", "close.line.onlineTickets"], ["booking_deposit", "close.line.bookingDeposit"],
  ["refund", "close.line.refund"], ["tips", "close.line.tips"], ["safe_drop", "close.line.safeDrop"],
  ["manual_correction", "close.line.correction"],
] as const satisfies ReadonlyArray<readonly [string,AuthMessageKey]>;

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
  const {t,locale}=useAuthLocale();
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
        locale: locale==="nl"?"nl-NL":"en-US",
        metadata: { note: String(formData.get("note") ?? "") },
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    await response.json() as { errorCode?: string };
    setPending(false);
    if (!response.ok) { setError(t("close.lineFailed")); return; }
    router.refresh();
  }

  async function transition(target: string, reason?: string) {
    setPending(true); setError("");
    const response = await fetch(`/api/closes/${closeId}/transition`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, reason: reason || null }),
    });
    const result = (await response.json()) as { errorCode?: string; close?: { id: string } };
    setPending(false);
    if (!response.ok) { setError(t("close.transitionFailed")); return; }
    if (target === "reopened" && result.close?.id) router.push(`/app/close/${result.close.id}`);
    else router.refresh();
  }

  const editable = status === "draft" || status === "reopened";
  return <div className="workflow-stack">
    {editable && <form className="workflow-card" action={addLine}>
      <h3>{t("close.addLine")}</h3>
      <div className="workflow-fields three">
        <label>{t("close.type")}<select name="lineType" required>{lineTypes.map(([value,key])=><option key={value} value={value}>{t(key)}</option>)}</select></label>
        <label>{t("close.expected")}<input name="expected" inputMode="decimal" required placeholder={locale==="nl"?"0,00":"0.00"}/></label>
        <label>{t("close.actual")}<input name="actual" inputMode="decimal" required placeholder={locale==="nl"?"0,00":"0.00"}/></label>
      </div>
      <label>{t("close.note")}<input name="note" maxLength={300}/></label>
      <button className="primary" disabled={pending} aria-busy={pending}>{t("close.saveLine")}</button>
    </form>}
    <div className="action-bar">
      {editable && <button className="primary" disabled={pending} onClick={()=>transition("submitted")}>{t("close.submit")}</button>}
      {status === "submitted" && canApprove && <button className="primary" disabled={pending} onClick={()=>transition("approved")}>{t("close.approve")}</button>}
      {status === "approved" && canApprove && <button className="ghost" disabled={pending} onClick={()=>transition("locked")}>{t("close.lock")}</button>}
      {(status === "approved" || status === "locked") && canReopen && <ReopenButton disabled={pending} onReopen={(reason)=>transition("reopened",reason)}/>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

function ReopenButton({disabled,onReopen}:{disabled:boolean;onReopen:(reason:string)=>void}) {
  const {t}=useAuthLocale();
  const [reason,setReason]=useState("");
  return <div className="reopen-control">
    <input aria-label={t("close.reopenReason")} value={reason} onChange={(event)=>setReason(event.target.value)} placeholder={t("close.reopenPlaceholder")}/>
    <button className="ghost" disabled={disabled || reason.trim().length < 10} onClick={()=>onReopen(reason)}>{t("close.newVersion")}</button>
  </div>;
}
