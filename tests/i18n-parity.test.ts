import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { authenticatedMessages } from "../lib/i18n/authenticated";

describe("authenticated NL/EN translation parity", () => {
  it("has identical canonical keys in Dutch and English", () => {
    expect(Object.keys(authenticatedMessages.en).sort()).toEqual(Object.keys(authenticatedMessages.nl).sort());
  });

  it("contains no empty values or rendered translation keys", () => {
    for (const messages of Object.values(authenticatedMessages)) {
      for (const [key, value] of Object.entries(messages)) {
        expect(value.trim(), key).not.toBe("");
        expect(value, key).not.toBe(key);
      }
    }
  });

  it("keeps hard-coded Dutch operator copy out of critical authenticated components", () => {
    const files = [
      "app/auth-form.tsx",
      "app/close-form.tsx",
      "app/close-workspace.tsx",
      "app/inventory-count-workspace.tsx",
      "app/pos-import-workspace.tsx",
      "app/pos-mapping-workspace.tsx",
      "app/reconciliation-workspace.tsx",
      "app/authenticated-app.tsx",
      "app/availability-manager.tsx",
      "app/onboarding/onboarding-form.tsx",
      "app/workflow-form.tsx",
    ];
    const operatorCopy = /\b(Vestiging|Afsluiting|Controle|Telling|Bevestig|Geen|Verwacht|Werkelijk|Toelichting|Wachtwoord|E-mailadres|Opslaan|Producten|Leverancier|Medewerker|Rooster|Beschikbaarheid|Uren|Incident|Beleid)\b/;
    for (const file of files) {
      expect(readFileSync(resolve(file), "utf8"), file).not.toMatch(operatorCopy);
    }
  });
});
