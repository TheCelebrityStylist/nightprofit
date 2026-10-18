/**
 * WhatsApp credentials entered in the app (Team → WhatsApp) instead of as hosting secrets.
 * Stored encrypted (AES-256-GCM) in integration_connections; only the server can decrypt,
 * with a key derived from the service-role secret. Hosting secrets still win when set.
 */
import { serverEnv } from "../env";
import { createSupabaseAdminClient } from "../supabase/admin";
import { DEFAULT_TEMPLATES, whatsappConfig, type WhatsappConfig } from "./cloud";

export const WHATSAPP_CONNECTOR = "whatsapp_cloud";
export type WhatsappSetup = { token: string; phoneNumberId: string; wabaId: string; appId: string; appSecret: string; verifyToken: string };
type Sealed = { v: 1; iv: string; data: string };

const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function cryptoKey(secret?: string) {
  const material = secret ?? serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!material) throw new Error("ENCRYPTION_KEY_MISSING");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`cliniq-whatsapp-v1:${material}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealSetup(setup: WhatsappSetup, secret?: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(secret), encoder.encode(JSON.stringify(setup))));
  return { v: 1, iv: toBase64(iv), data: toBase64(data) };
}

export async function openSetup(sealed: unknown, secret?: string): Promise<WhatsappSetup | null> {
  const value = sealed as Partial<Sealed> | null;
  if (!value || value.v !== 1 || !value.iv || !value.data) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(value.iv) }, await cryptoKey(secret), fromBase64(value.data));
    return JSON.parse(new TextDecoder().decode(plain)) as WhatsappSetup;
  } catch {
    return null;
  }
}

export type StoredConnection = { id: string; organisation_id: string; venue_id: string; connection_status: string; webhook_status: string | null; last_successful_sync_at: string | null; credential_tested_at: string | null; provider_account_id: string | null };

export async function storedSetup(organisationId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("integration_connections").select("id,organisation_id,venue_id,connection_status,webhook_status,last_successful_sync_at,credential_tested_at,provider_account_id,encrypted_credential").eq("organisation_id", organisationId).eq("connector_key", WHATSAPP_CONNECTOR).limit(1);
  const row = (data ?? [])[0] as (StoredConnection & { encrypted_credential: unknown }) | undefined;
  if (!row) return null;
  const setup = await openSetup(row.encrypted_credential);
  return setup ? { setup, row } : null;
}

/** Every stored setup; the webhook does not know which organisation a call is for until it checks the signature. */
export async function allStoredSetups() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("integration_connections").select("id,organisation_id,encrypted_credential").eq("connector_key", WHATSAPP_CONNECTOR);
  const rows = (data ?? []) as { id: string; organisation_id: string; encrypted_credential: unknown }[];
  const opened = await Promise.all(rows.map(async (row) => ({ id: row.id, organisationId: row.organisation_id, setup: await openSetup(row.encrypted_credential) })));
  return opened.filter((row): row is { id: string; organisationId: string; setup: WhatsappSetup } => Boolean(row.setup));
}

export const configFromSetup = (setup: WhatsappSetup): WhatsappConfig => ({ token: setup.token, phoneNumberId: setup.phoneNumberId, graphVersion: "v23.0", language: "nl", templates: { ...DEFAULT_TEMPLATES } });

/** Hosting secrets first, then what the owner entered in the app. */
export async function loadWhatsapp(organisationId: string): Promise<WhatsappConfig | null> {
  const fromEnv = whatsappConfig();
  if (fromEnv) return fromEnv;
  try {
    const stored = await storedSetup(organisationId);
    return stored ? configFromSetup(stored.setup) : null;
  } catch {
    return null;
  }
}

export async function whatsappReady(organisationId: string) {
  return Boolean(await loadWhatsapp(organisationId));
}
