import { cookies } from "next/headers";
import { getDictionary, LOCALE_COOKIE, resolveLocale, type Dictionary, type Locale } from ".";

// Reads the persisted locale from the request cookie during server rendering.
// Falls back to the default locale when no valid cookie is present.
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function getTranslations(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
}
