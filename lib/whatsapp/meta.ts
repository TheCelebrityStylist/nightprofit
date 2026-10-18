/** Meta Graph API calls used to connect, check and set up the WhatsApp number from inside the app. */
import { DEFAULT_TEMPLATES, type WhatsappTemplateKey } from "./cloud";
import type { WhatsappSetup } from "./store";

const GRAPH = "https://graph.facebook.com/v23.0";

/**
 * The three Utility templates the app sends. Parameter order must match the senders:
 * roster [first name, venue, week, shifts, hours], availability [first name, nights, deadline, link],
 * invite [first name, venue, link]. Meta rejects templates that start or end with a variable.
 */
export const TEMPLATE_DEFINITIONS: Record<WhatsappTemplateKey, { title: string; text: string; example: string[] }> = {
  roster: {
    title: "Rooster",
    text: "Hoi {{1}}! Je rooster bij {{2}} voor week {{3}} staat klaar: {{4}}. Totaal {{5}} uur. Klopt er iets niet? Laat het je planner weten.",
    example: ["Sam", "Cliniq", "43", "do 22 okt 21:30-02:00, za 24 okt 23:00-03:00", "8"],
  },
  availability: {
    title: "Beschikbaarheid",
    text: "Hoi {{1}}! Kun je {{2}} werken? Laat het weten vóór {{3}} via je persoonlijke link: {{4}} Het kost je tien seconden.",
    example: ["Sam", "do 22, vr 23 en za 24 okt", "wo 21 okt 20:00", "https://cliniq.team/availability/voorbeeld"],
  },
  invite: {
    title: "Uitnodiging",
    text: "Hoi {{1}}! Je staat in het team van {{2}}. Maak je account aan via {{3}} Daarna zie je je rooster en geef je door wanneer je kunt.",
    example: ["Sam", "Cliniq", "https://cliniq.team/employee-onboarding/voorbeeld"],
  },
};

export type MetaResult<T> = { ok: true; data: T } | { ok: false; message: string; code?: number };

async function graph<T>(path: string, init: RequestInit & { token: string }, fetcher: typeof fetch = fetch): Promise<MetaResult<T>> {
  try {
    const { token, ...rest } = init;
    const response = await fetcher(`${GRAPH}/${path}`, { ...rest, headers: { authorization: `Bearer ${token}`, ...(rest.body ? { "content-type": "application/json" } : {}) } });
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string; code?: number } } & T;
    if (!response.ok || body.error) return { ok: false, message: body.error?.error_user_msg || body.error?.message || `Meta antwoordde met ${response.status}.`, code: body.error?.code };
    return { ok: true, data: body };
  } catch {
    return { ok: false, message: "Meta is niet bereikbaar. Probeer het zo opnieuw." };
  }
}

export type PhoneInfo = { display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string; name_status?: string };
export const phoneInfo = (setup: Pick<WhatsappSetup, "token" | "phoneNumberId">, fetcher?: typeof fetch) =>
  graph<PhoneInfo>(`${encodeURIComponent(setup.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status`, { token: setup.token }, fetcher);

export type TemplateRow = { name: string; status: string; language: string; rejected_reason?: string };
export async function templateStatus(setup: Pick<WhatsappSetup, "token" | "wabaId">, fetcher?: typeof fetch) {
  const result = await graph<{ data?: TemplateRow[] }>(`${encodeURIComponent(setup.wabaId)}/message_templates?fields=name,status,language,rejected_reason&limit=200`, { token: setup.token }, fetcher);
  if (!result.ok) return result;
  const rows = result.data.data ?? [];
  return {
    ok: true as const,
    data: (Object.keys(DEFAULT_TEMPLATES) as WhatsappTemplateKey[]).map((key) => {
      const row = rows.find((item) => item.name === DEFAULT_TEMPLATES[key] && item.language === "nl");
      return { key, name: DEFAULT_TEMPLATES[key], title: TEMPLATE_DEFINITIONS[key].title, text: TEMPLATE_DEFINITIONS[key].text, status: row?.status ?? "MISSING", reason: row?.rejected_reason && row.rejected_reason !== "NONE" ? row.rejected_reason : null };
    }),
  };
}

export function createTemplate(setup: Pick<WhatsappSetup, "token" | "wabaId">, key: WhatsappTemplateKey, fetcher?: typeof fetch) {
  const definition = TEMPLATE_DEFINITIONS[key];
  return graph<{ id?: string; status?: string }>(`${encodeURIComponent(setup.wabaId)}/message_templates`, {
    token: setup.token,
    method: "POST",
    body: JSON.stringify({ name: DEFAULT_TEMPLATES[key], language: "nl", category: "UTILITY", components: [{ type: "BODY", text: definition.text, example: { body_text: [definition.example] } }] }),
  }, fetcher);
}

/** Points the Meta app's webhook at this app and subscribes the business account to it. */
export async function connectWebhook(setup: WhatsappSetup, callbackUrl: string, fetcher: typeof fetch = fetch): Promise<MetaResult<true>> {
  try {
    const form = new URLSearchParams({ object: "whatsapp_business_account", callback_url: callbackUrl, verify_token: setup.verifyToken, fields: "messages", access_token: `${setup.appId}|${setup.appSecret}` });
    const response = await fetcher(`${GRAPH}/${encodeURIComponent(setup.appId)}/subscriptions`, { method: "POST", body: form });
    const body = (await response.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; error_user_msg?: string } };
    if (!response.ok || !body.success) return { ok: false, message: body.error?.error_user_msg || body.error?.message || "Meta kon de webhook niet bevestigen." };
  } catch {
    return { ok: false, message: "Meta is niet bereikbaar. Probeer het zo opnieuw." };
  }
  const subscribed = await graph<{ success?: boolean }>(`${encodeURIComponent(setup.wabaId)}/subscribed_apps`, { token: setup.token, method: "POST", body: "{}" }, fetcher);
  return subscribed.ok ? { ok: true, data: true } : subscribed;
}

/** Meta's own pre-approved test template; works before our templates are approved. */
export function sendTestMessage(setup: Pick<WhatsappSetup, "token" | "phoneNumberId">, to: string, fetcher?: typeof fetch) {
  return graph<{ messages?: { id: string }[] }>(`${encodeURIComponent(setup.phoneNumberId)}/messages`, {
    token: setup.token,
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/[^\d]/g, ""), type: "template", template: { name: "hello_world", language: { code: "en_US" } } }),
  }, fetcher);
}
