"use client";

import { useState } from "react";

type RoleOption = { id: string; name: string; department_id: string; lane: "staff" | "dj" };
type Created = { staffId: string; name: string; phone: string; link: string; whatsappUrl: string };

export function AddPersonPanel({
  organisationId,
  venueId,
  roles,
  defaultLane,
  whatsappReady,
  locale,
  onDone,
  onClose,
}: {
  organisationId: string;
  venueId: string;
  roles: RoleOption[];
  defaultLane: "staff" | "dj";
  whatsappReady: boolean;
  locale: "nl" | "en";
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const tx = (nl: string, en: string) => (locale === "nl" ? nl : en);
  const firstRole = roles.find((role) => role.lane === defaultLane) ?? roles[0];
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState(firstRole?.id ?? "");
  const [contract, setContract] = useState<"employee" | "temporary" | "contractor">(firstRole?.lane === "dj" ? "contractor" : "employee");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [inviteState, setInviteState] = useState("");
  const role = roles.find((item) => item.id === roleId);

  async function save() {
    if (!role || name.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/planning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId,
          locale: locale === "nl" ? "nl-NL" : "en-US",
          action: "staff",
          values: { venueId, departmentId: role.department_id, roleId: role.id, fullName: name.trim(), email: "", phone: phone.trim(), accessRole: "employee", engagementType: contract, preferredLanguage: locale },
        }),
      });
      const result = (await response.json()) as { errorCode?: string; staffId?: string; invitation?: { link: string; whatsappUrl: string } };
      if (!response.ok) {
        throw new Error(
          result.errorCode === "DUPLICATE_STAFF" ? tx("Er staat al iemand met dit nummer in het team.", "Someone with this number is already in the team.")
          : result.errorCode === "INVALID_PHONE" ? tx("Dit telefoonnummer klopt niet. Gebruik bijvoorbeeld 06 12345678.", "This phone number is not valid. Use e.g. 06 12345678.")
          : result.errorCode === "FORBIDDEN" ? tx("Alleen eigenaar of beheerder kan mensen toevoegen.", "Only an owner or administrator can add people.")
          : tx("Toevoegen lukte niet. Probeer het opnieuw.", "Adding failed. Try again."),
        );
      }
      setCreated({ staffId: result.staffId ?? "", name: name.trim(), phone: phone.trim(), link: result.invitation?.link ?? "", whatsappUrl: result.invitation?.whatsappUrl ?? "" });
      onDone(tx(`${name.trim()} staat in het team.`, `${name.trim()} is in the team.`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Toevoegen lukte niet.", "Adding failed."));
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    if (!created) return;
    setBusy(true);
    setInviteState("");
    try {
      const response = await fetch("/api/whatsapp/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "invite", organisationId, venueId, staffId: created.staffId, link: created.link }) });
      const result = (await response.json()) as { delivery?: { detail: string } };
      setInviteState(response.ok ? tx("Uitnodiging verstuurd via WhatsApp.", "Invitation sent via WhatsApp.") : result.delivery?.detail ?? tx("Versturen lukte niet.", "Sending failed."));
    } finally {
      setBusy(false);
    }
  }

  const reset = () => { setCreated(null); setName(""); setPhone(""); setInviteState(""); setError(""); };

  if (created) {
    return (
      <section className="add-person done">
        <span className="eyebrow">{tx("TOEGEVOEGD", "ADDED")}</span>
        <h3>{tx(`${created.name} staat in het team`, `${created.name} is in the team`)}</h3>
        <p>{tx("Je kunt diegene nu direct inroosteren. Een account is alleen nodig om zelf het rooster te zien en beschikbaarheid door te geven.", "You can schedule them right away. An account is only needed to see their own roster and give availability.")}</p>
        {created.phone ? (
          whatsappReady ? (
            <button type="button" className="primary" disabled={busy || Boolean(inviteState)} onClick={() => void invite()}>{tx("Stuur uitnodiging via WhatsApp", "Send invitation via WhatsApp")}</button>
          ) : created.whatsappUrl ? (
            <a className="primary" href={created.whatsappUrl} target="_blank" rel="noreferrer">{tx("Uitnodiging openen in WhatsApp", "Open invitation in WhatsApp")}</a>
          ) : null
        ) : (
          <p className="quiet">{tx("Geen telefoonnummer: uitnodigen kan later via Team.", "No phone number: you can invite later via Team.")}</p>
        )}
        {created.link ? <button type="button" onClick={() => { void navigator.clipboard.writeText(created.link); setInviteState(tx("Link gekopieerd.", "Link copied.")); }}>{tx("Kopieer uitnodigingslink", "Copy invitation link")}</button> : null}
        {inviteState ? <p className="add-person-note" role="status">{inviteState}</p> : null}
        <div className="add-person-actions">
          <button type="button" onClick={reset}>{tx("Nog iemand toevoegen", "Add someone else")}</button>
          <button type="button" className="ghost" onClick={onClose}>{tx("Klaar", "Done")}</button>
        </div>
      </section>
    );
  }

  return (
    <form className="add-person" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <span className="eyebrow">{tx("TEAM", "TEAM")}</span>
      <h3>{tx("Persoon toevoegen", "Add a person")}</h3>
      <label>{tx("Naam", "Name")}<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={140} autoComplete="off" autoFocus placeholder={tx("Voor- en achternaam", "First and last name")} /></label>
      <label>{tx("Telefoon", "Phone")} <small>{tx("optioneel · nodig voor WhatsApp", "optional · needed for WhatsApp")}</small><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="off" placeholder="06 …" /></label>
      <fieldset className="add-person-roles">
        <legend>{tx("Wat doet diegene?", "What do they do?")}</legend>
        {roles.map((item) => (
          <button type="button" key={item.id} aria-pressed={roleId === item.id} className={roleId === item.id ? "on" : ""} onClick={() => { setRoleId(item.id); setContract(item.lane === "dj" ? "contractor" : "employee"); }}>{item.name}</button>
        ))}
      </fieldset>
      <fieldset className="add-person-roles add-person-contract">
        <legend>{tx("Soort", "Type")}</legend>
        {([["employee", tx("Vast", "Regular")], ["temporary", tx("Oproepkracht", "On call")], ["contractor", tx("Zzp", "Freelance")]] as const).map(([value, label]) => (
          <button type="button" key={value} aria-pressed={contract === value} className={contract === value ? "on" : ""} onClick={() => setContract(value)}>{label}</button>
        ))}
      </fieldset>
      {error ? <p className="add-person-error" role="alert">{error}</p> : null}
      <button className="primary" disabled={busy || name.trim().length < 2 || !role}>{busy ? tx("Bezig…", "Saving…") : tx("Toevoegen", "Add")}</button>
    </form>
  );
}
