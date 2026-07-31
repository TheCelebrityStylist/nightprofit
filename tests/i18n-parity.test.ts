import { describe, expect, it } from "vitest";
import { getDictionary, LOCALES, type Locale } from "../lib/i18n";

// Collect every leaf key path in a nested dictionary, e.g. "auth.titleLogin".
function keyPaths(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      keyPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function leafValues(value: unknown): unknown[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).flatMap(leafValues);
  }
  return [value];
}

describe("i18n dictionary parity", () => {
  const canonical = keyPaths(getDictionary("nl")).sort();

  it("exposes every supported locale", () => {
    expect([...LOCALES]).toEqual(["nl", "en"]);
  });

  for (const locale of LOCALES) {
    it(`has identical key coverage for ${locale}`, () => {
      expect(keyPaths(getDictionary(locale as Locale)).sort()).toEqual(canonical);
    });

    it(`has only non-empty string values for ${locale}`, () => {
      for (const value of leafValues(getDictionary(locale as Locale))) {
        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    });
  }

  it("does not leave English strings identical to Dutch for translated copy", () => {
    // Sanity check that EN was actually translated, not copied. A handful of
    // proper nouns / codes are legitimately identical across locales.
    const nl = getDictionary("nl");
    const en = getDictionary("en");
    const identical = keyPaths(nl).filter((path) => {
      const read = (dict: unknown) =>
        path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], dict);
      return read(nl) === read(en);
    });
    // Known-identical: navigation proper nouns, LIVE·SUPABASE label, locale endonyms.
    const allowed = new Set([
      "nav.commandCenter", "nav.events", "shell.liveSupabase",
      "locale.toEnglish", "locale.toDutch", "onboarding.type", "onboarding.typeBar",
    ]);
    const unexpected = identical.filter((path) => !allowed.has(path));
    expect(unexpected).toEqual([]);
  });
});
