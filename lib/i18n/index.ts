// Single typed translation system for NightProfit's authenticated product.
// `nl` is the canonical key set. `en` is typed as `Dictionary`, so TypeScript
// fails the build if any key is missing or extra. A runtime parity test
// (tests/i18n-parity.test.ts) additionally guards against empty strings and
// accidental casts.

export const LOCALES = ["nl", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "nl";
export const LOCALE_COOKIE = "np_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

const nl = {
  locale: { self: "Nederlands", switchLabel: "Taal", toEnglish: "English", toDutch: "Nederlands" },
  common: {
    genericError: "Er ging iets mis.",
    checkEmail: "Controleer je e-mail.",
    saveFailed: "Opslaan mislukt.",
    checkInput: "Controleer de ingevoerde gegevens.",
    loading: "Bezig…",
    saving: "Opslaan…",
  },
  auth: {
    eyebrowLogin: "VEILIG INLOGGEN",
    eyebrowSignup: "START JE WINSTDIAGNOSE",
    eyebrowRecover: "ACCOUNT HERSTEL",
    titleLogin: "Welkom terug",
    titleSignup: "Maak je account",
    titleForgot: "Wachtwoord vergeten",
    titleUpdate: "Nieuw wachtwoord",
    descSignup: "Je bevestigt eerst je e-mailadres. Daarna richt je organisatie en eerste vestiging in.",
    descDefault: "Je sessie wordt veilig beheerd met httpOnly cookies.",
    fieldName: "Naam",
    fieldEmail: "E-mailadres",
    fieldPassword: "Wachtwoord",
    submitLogin: "Inloggen",
    submitSignup: "Account maken",
    submitForgot: "Herstellink versturen",
    submitUpdate: "Wachtwoord bijwerken",
    footerForgot: "Wachtwoord vergeten?",
    footerSignup: "Nog geen account?",
    footerBack: "Terug naar inloggen",
  },
  onboarding: {
    eyebrow: "ONBOARDING · STAP 1 EN 2",
    title: "Je eerste organisatie",
    desc: "Deze gegevens worden direct opgeslagen. Je kunt de verdere configuratie later hervatten.",
    organisationName: "Organisatienaam",
    firstVenue: "Eerste vestiging",
    type: "Type",
    typeNightclub: "Nachtclub",
    typeBar: "Bar",
    typeEventVenue: "Eventlocatie",
    timezone: "Tijdzone",
    submit: "Organisatie aanmaken",
  },
  nav: {
    commandCenter: "Command Center",
    nightlyClose: "Nachtafsluiting",
    events: "Events",
    bookings: "Groepsboekingen",
    suppliers: "Leveranciers & contracten",
    margins: "Producten & marges",
    yield: "Event yield",
    compliance: "Team & compliance",
    alerts: "Signalen & acties",
    reports: "Rapporten",
    integrations: "Integraties",
    settings: "Instellingen",
    billing: "Facturatie",
  },
  shell: {
    currentOrganisation: "Huidige organisatie",
    venuesSuffix: "vestiging(en)",
    securedTenantData: "Beveiligde tenantdata",
    noVenue: "Nog geen vestiging",
    logout: "Uitloggen",
    liveSupabase: "LIVE · SUPABASE",
    heroLead: "Alle gegevens hieronder zijn beperkt tot je huidige organisatie en toegewezen vestigingen.",
    newClose: "Nieuwe afsluiting",
  },
  dashboard: {
    metricVenues: "Vestigingen",
    metricVenuesNote: "Toegankelijk binnen deze organisatie",
    metricSubmitted: "Ingediende closes",
    metricSubmittedNote: "Wachten op bevoegde goedkeuring",
    metricApproved: "Goedgekeurd/vergrendeld",
    metricApprovedNote: "Historie met onveranderlijke snapshots",
    recentTitle: "Recente afsluitingen",
    recentSubtitle: "Live uit de beveiligde tenantdatabase.",
    emptyTitle: "Nog geen echte afsluitingen",
    emptyBody: "Maak de eerste afsluiting aan. Synthetische voorbeelden blijven uitsluitend beschikbaar onder /demo.",
    openEvidence: "Open bewijs →",
    venueFallback: "Vestiging",
    moduleEmptyBody: "Deze beveiligde module bevat geen fictieve klantcijfers. Configureer of importeer geverifieerde gegevens om de workflow te starten.",
  },
  closeForm: {
    title: "Nieuwe nightly close",
    desc: "Bedragen worden na invoer server-side in gehele centen opgeslagen.",
    venue: "Vestiging",
    venuePlaceholder: "Kies een vestiging",
    tradingDate: "Handelsdatum",
    submit: "Afsluiting aanmaken",
    errorDuplicate: "Voor deze handelsdatum bestaat al een afsluiting.",
    errorCreateFailed: "Afsluiting kon niet worden aangemaakt.",
    errorInvalid: "Ongeldige of niet-toegestane aanvraag.",
  },
} as const;

// Widen the literal string leaves of the canonical `nl` dictionary to `string`
// so translations may differ while the key structure stays enforced.
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Dictionary = Widen<typeof nl>;

const en: Dictionary = {
  locale: { self: "English", switchLabel: "Language", toEnglish: "English", toDutch: "Nederlands" },
  common: {
    genericError: "Something went wrong.",
    checkEmail: "Check your email.",
    saveFailed: "Saving failed.",
    checkInput: "Please check the details you entered.",
    loading: "Loading…",
    saving: "Saving…",
  },
  auth: {
    eyebrowLogin: "SECURE SIGN-IN",
    eyebrowSignup: "START YOUR PROFIT DIAGNOSIS",
    eyebrowRecover: "ACCOUNT RECOVERY",
    titleLogin: "Welcome back",
    titleSignup: "Create your account",
    titleForgot: "Forgot password",
    titleUpdate: "New password",
    descSignup: "You confirm your email address first. Then you set up your organisation and first venue.",
    descDefault: "Your session is managed securely with httpOnly cookies.",
    fieldName: "Name",
    fieldEmail: "Email address",
    fieldPassword: "Password",
    submitLogin: "Sign in",
    submitSignup: "Create account",
    submitForgot: "Send reset link",
    submitUpdate: "Update password",
    footerForgot: "Forgot password?",
    footerSignup: "No account yet?",
    footerBack: "Back to sign in",
  },
  onboarding: {
    eyebrow: "ONBOARDING · STEPS 1 AND 2",
    title: "Your first organisation",
    desc: "These details are saved immediately. You can resume the rest of the configuration later.",
    organisationName: "Organisation name",
    firstVenue: "First venue",
    type: "Type",
    typeNightclub: "Nightclub",
    typeBar: "Bar",
    typeEventVenue: "Event venue",
    timezone: "Time zone",
    submit: "Create organisation",
  },
  nav: {
    commandCenter: "Command Center",
    nightlyClose: "Nightly Close",
    events: "Events",
    bookings: "Group Bookings",
    suppliers: "Suppliers & Contracts",
    margins: "Products & Margins",
    yield: "Event Yield",
    compliance: "Team & Compliance",
    alerts: "Alerts & Actions",
    reports: "Reports",
    integrations: "Integrations",
    settings: "Settings",
    billing: "Billing",
  },
  shell: {
    currentOrganisation: "Current organisation",
    venuesSuffix: "venue(s)",
    securedTenantData: "Secured tenant data",
    noVenue: "No venue yet",
    logout: "Sign out",
    liveSupabase: "LIVE · SUPABASE",
    heroLead: "All data below is limited to your current organisation and assigned venues.",
    newClose: "New close",
  },
  dashboard: {
    metricVenues: "Venues",
    metricVenuesNote: "Accessible within this organisation",
    metricSubmitted: "Submitted closes",
    metricSubmittedNote: "Awaiting authorised approval",
    metricApproved: "Approved/locked",
    metricApprovedNote: "History with immutable snapshots",
    recentTitle: "Recent closes",
    recentSubtitle: "Live from the secured tenant database.",
    emptyTitle: "No real closes yet",
    emptyBody: "Create the first close. Synthetic examples remain available only under /demo.",
    openEvidence: "Open evidence →",
    venueFallback: "Venue",
    moduleEmptyBody: "This secured module contains no fictitious customer figures. Configure or import verified data to start the workflow.",
  },
  closeForm: {
    title: "New nightly close",
    desc: "After entry, amounts are stored server-side in whole cents.",
    venue: "Venue",
    venuePlaceholder: "Choose a venue",
    tradingDate: "Trading date",
    submit: "Create close",
    errorDuplicate: "A close already exists for this trading date.",
    errorCreateFailed: "The close could not be created.",
    errorInvalid: "Invalid or not-permitted request.",
  },
};

const dictionaries: Record<Locale, Dictionary> = { nl, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
