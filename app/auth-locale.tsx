"use client";

import { createContext, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authIntlLocale, authMessage, type AuthLocale, type AuthMessageKey } from "../lib/i18n/authenticated";

type LocaleContextValue = {
  locale: AuthLocale;
  intlLocale: "nl-NL" | "en-GB";
  t: (key: AuthMessageKey) => string;
  setLocale: (locale: AuthLocale) => void;
  switching: boolean;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function AuthLocaleProvider({ initialLocale, children }: { initialLocale: AuthLocale; children: ReactNode }) {
  const router = useRouter();
  const [locale, setLocalLocale] = useState(initialLocale);
  const [switching, startTransition] = useTransition();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    intlLocale: authIntlLocale(locale),
    t: (key) => authMessage(locale, key),
    switching,
    setLocale: (nextLocale) => {
      if (nextLocale === locale) return;
      setLocalLocale(nextLocale);
      document.cookie = `nightprofit_locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
      startTransition(() => router.refresh());
    },
  }), [locale, router, switching]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useAuthLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("AUTH_LOCALE_PROVIDER_MISSING");
  return value;
}

export function AuthLocaleSwitch() {
  const { locale, setLocale, switching, t } = useAuthLocale();
  return <label className="locale-switch">
    <span className="sr-only">{t("language.label")}</span>
    <select aria-label={t("language.label")} value={locale} disabled={switching} onChange={(event) => setLocale(event.target.value as AuthLocale)}>
      <option value="nl">NL</option>
      <option value="en">EN</option>
    </select>
  </label>;
}
