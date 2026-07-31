"use client";

import { LOCALE_COOKIE, LOCALES, type Locale } from "../lib/i18n";

const ONE_YEAR = 60 * 60 * 24 * 365;

// Persists the chosen locale in a first-party cookie and reloads so that
// server components re-render with the new language. Locale is a UI
// preference only; canonical stored values remain locale-independent.
export function LocaleSwitcher({ locale, label }: { locale: Locale; label: string }) {
  function change(next: string) {
    if (next === locale) return;
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`;
    window.location.reload();
  }
  return (
    <select
      aria-label={label}
      value={locale}
      onChange={(event) => change(event.target.value)}
    >
      {LOCALES.map((option) => (
        <option key={option} value={option}>
          {option.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
