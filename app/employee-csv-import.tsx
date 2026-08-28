"use client";

import { useState } from "react";
import { useAuthLocale } from "./auth-locale";

type Preview = {
  accepted: Array<{ rowNumber: number; firstName: string; lastName: string; email: string; department: string; role: string }>;
  rejected: Array<{ rowNumber: number; code: string; message: string }>;
};

export function EmployeeCsvImport({ organisationId, venueId }: { organisationId: string; venueId: string }) {
  const { locale } = useAuthLocale();
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [decisions, setDecisions] = useState<Record<string, "create" | "reject" | "skip" | "merge">>({});

  async function inspect() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/workforce/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organisationId, venueId, source }),
    });
    const result = (await response.json()) as Preview;
    if (response.ok) {
      setPreview(result);
      setDecisions(Object.fromEntries(result.accepted.map((row) => [String(row.rowNumber), "create"])));
    } else setMessage(tx("Voorbeeld kon niet worden gevalideerd.", "Preview validation failed."));
    setBusy(false);
  }

  async function commit() {
    if (!preview?.accepted.length) return;
    setBusy(true);
    const response = await fetch("/api/workforce/employees", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organisationId, venueId, source, idempotencyKey: crypto.randomUUID(), decisions }),
    });
    setMessage(response.ok
      ? tx("Goedgekeurde medewerkers geïmporteerd; afgewezen rijen zijn niet geschreven.", "Approved employees imported; rejected rows were not written.")
      : tx("Import gestopt; controleer duplicaatbesluiten.", "Import stopped; review duplicate decisions."));
    setBusy(false);
  }

  return <section className="employee-import">
    <h4>{tx("Medewerkers importeren", "Import employees")}</h4>
    <p>{tx("Controleer alle rijen voordat er iets wordt opgeslagen.", "Review every row before anything is saved.")}</p>
    <label>{tx("CSV-bestand", "CSV file")}<input type="file" accept=".csv,text/csv" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { setSource(await file.text()); setPreview(null); } }} /></label>
    <button className="secondary" type="button" disabled={busy || !source} onClick={() => void inspect()}>{tx("Voorbeeld controleren", "Validate preview")}</button>
    {preview ? <div className="import-preview">
      <b>{preview.accepted.length} {tx("geldige rijen", "valid rows")} · {preview.rejected.length} {tx("afgewezen", "rejected")}</b>
      {preview.rejected.map((row) => <p className="form-error" key={row.rowNumber}>{tx("Rij", "Row")} {row.rowNumber}: {row.code} — {row.message}</p>)}
      {preview.accepted.map((row) => <div className="import-row" key={row.rowNumber}>
        <span>{row.firstName} {row.lastName}<small>{row.email} · {row.department} / {row.role}</small></span>
        <select aria-label={`${tx("Besluit rij", "Decision row")} ${row.rowNumber}`} value={decisions[String(row.rowNumber)] ?? "create"} onChange={(event) => setDecisions((current) => ({ ...current, [String(row.rowNumber)]: event.target.value as "create" | "reject" | "skip" | "merge" }))}>
          <option value="create">{tx("Aanmaken", "Create")}</option><option value="merge">{tx("Samenvoegen bij duplicaat", "Merge duplicate")}</option><option value="skip">{tx("Overslaan", "Skip")}</option><option value="reject">{tx("Afwijzen bij duplicaat", "Reject duplicate")}</option>
        </select>
      </div>)}
      <button className="primary" type="button" disabled={busy || preview.accepted.length === 0} onClick={() => void commit()}>{tx("Gecontroleerde import uitvoeren", "Commit reviewed import")}</button>
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
