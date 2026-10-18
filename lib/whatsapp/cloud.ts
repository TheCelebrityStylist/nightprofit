/**
 * WhatsApp Business Platform (Cloud API) client.
 *
 * Business-initiated messages must use templates that Meta approved beforehand.
 * Template body parameters may not contain line breaks, tabs or more than four
 * spaces in a row, so every value goes through cleanParam().
 */

export type WhatsappTemplateKey = "roster" | "availability" | "invite";

export type WhatsappConfig = {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
  language: string;
  templates: Record<WhatsappTemplateKey, string>;
};

export type SendResult = { ok: true; messageId: string } | { ok: false; code: string; detail: string };

const env = (name: string) => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const WHATSAPP_REQUIRED_SECRETS = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] as const;

export function whatsappConfig(): WhatsappConfig | null {
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    graphVersion: env("WHATSAPP_GRAPH_VERSION") ?? "v23.0",
    language: env("WHATSAPP_TEMPLATE_LANGUAGE") ?? "nl",
    templates: {
      roster: env("WHATSAPP_TEMPLATE_ROSTER") ?? "rooster_gepubliceerd",
      availability: env("WHATSAPP_TEMPLATE_AVAILABILITY") ?? "beschikbaarheid_opvragen",
      invite: env("WHATSAPP_TEMPLATE_INVITE") ?? "team_uitnodiging",
    },
  };
}

export function whatsappStatus() {
  const missing = WHATSAPP_REQUIRED_SECRETS.filter((name) => !env(name));
  return { configured: missing.length === 0, missing, webhookReady: Boolean(env("WHATSAPP_WEBHOOK_VERIFY_TOKEN") && env("WHATSAPP_APP_SECRET")) };
}

/** Meta rejects parameters with newlines, tabs or 5+ consecutive spaces (error 132018). */
export function cleanParam(value: string, maxLength = 700): string {
  const flat = value.replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat || "-";
}

/** E.164 without the plus, which is what the Cloud API expects in `to`. */
export function toRecipient(e164: string): string {
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("INVALID_RECIPIENT");
  return digits;
}

export function templateMessage(to: string, template: string, language: string, params: string[]) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toRecipient(to),
    type: "template",
    template: {
      name: template,
      language: { code: language },
      components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text: cleanParam(text) })) }] : [],
    },
  };
}

export async function sendTemplate(config: WhatsappConfig, to: string, key: WhatsappTemplateKey, params: string[], fetcher: typeof fetch = fetch): Promise<SendResult> {
  let body: ReturnType<typeof templateMessage>;
  try {
    body = templateMessage(to, config.templates[key], config.language, params);
  } catch {
    return { ok: false, code: "INVALID_RECIPIENT", detail: "Telefoonnummer is ongeldig." };
  }
  try {
    const response = await fetcher(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number; message?: string; error_data?: { details?: string } } };
    if (response.ok && result.messages?.[0]?.id) return { ok: true, messageId: result.messages[0].id };
    const code = String(result.error?.code ?? response.status);
    return { ok: false, code, detail: explainError(code, result.error?.error_data?.details ?? result.error?.message ?? "") };
  } catch {
    return { ok: false, code: "NETWORK", detail: "WhatsApp was niet bereikbaar." };
  }
}

/** Plain-language reasons for the errors a planner will actually run into. */
export function explainError(code: string, fallback: string): string {
  const known: Record<string, string> = {
    "131026": "Dit nummer heeft geen WhatsApp of kan dit bericht niet ontvangen.",
    "132001": "De template bestaat niet of is nog niet goedgekeurd door Meta.",
    "132000": "Het aantal velden in de template klopt niet.",
    "132018": "Een veld bevat tekens die WhatsApp niet toestaat.",
    "131047": "Buiten het 24-uursvenster: alleen goedgekeurde templates zijn toegestaan.",
    "130429": "Te veel berichten tegelijk. Probeer het over een minuut opnieuw.",
    "131056": "Te veel berichten naar dit nummer in korte tijd.",
    "190": "De WhatsApp-toegangstoken is verlopen of ongeldig.",
    "100": "Een instelling (telefoonnummer-ID of template) klopt niet.",
  };
  return known[code] ?? (fallback || "WhatsApp weigerde het bericht.");
}

/** Verifies Meta's X-Hub-Signature-256 header over the raw request body. */
export async function verifySignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const supplied = header.slice(7).toLowerCase();
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
}

export type StatusUpdate = { messageId: string; state: "sent" | "delivered" | "read" | "failed"; failureReason: string | null };

/** Pulls message status updates out of a webhook payload. Inbound messages are ignored. */
export function statusUpdates(payload: unknown): StatusUpdate[] {
  const updates: StatusUpdate[] = [];
  const entries = (payload as { entry?: { changes?: { value?: { statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string }[] }[] } }[] }[] })?.entry ?? [];
  for (const entry of entries) for (const change of entry.changes ?? []) for (const status of change.value?.statuses ?? []) {
    if (!status.id || !status.status || !["sent", "delivered", "read", "failed"].includes(status.status)) continue;
    const error = status.errors?.[0];
    updates.push({ messageId: status.id, state: status.status as StatusUpdate["state"], failureReason: error ? explainError(String(error.code ?? ""), error.title ?? "") : null });
  }
  return updates;
}
