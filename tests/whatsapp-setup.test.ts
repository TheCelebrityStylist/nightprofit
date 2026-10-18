import { describe, expect, it } from "vitest";
import { openSetup, sealSetup, type WhatsappSetup } from "../lib/whatsapp/store";
import { connectWebhook, createTemplate, templateStatus, TEMPLATE_DEFINITIONS } from "../lib/whatsapp/meta";

const setup: WhatsappSetup = { token: "EAAB-test-token-1234567890", phoneNumberId: "1234567890", wabaId: "9876543210", appId: "1122334455", appSecret: "0123456789abcdef0123456789abcdef", verifyToken: "verify-me" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("stored WhatsApp credentials", () => {
  it("round-trips only with the same server secret", async () => {
    const sealed = await sealSetup(setup, "server-secret-aaaaaaaaaaaaaaaa");
    expect(JSON.stringify(sealed)).not.toContain(setup.token);
    expect(await openSetup(sealed, "server-secret-aaaaaaaaaaaaaaaa")).toEqual(setup);
    expect(await openSetup(sealed, "another-secret-bbbbbbbbbbbbbbbb")).toBeNull();
    expect(await openSetup({ v: 2 }, "server-secret-aaaaaaaaaaaaaaaa")).toBeNull();
  });
});

describe("Meta setup calls", () => {
  it("templates never start or end with a variable and match the sender parameter counts", () => {
    const counts = { roster: 5, availability: 4, invite: 3 };
    for (const [key, definition] of Object.entries(TEMPLATE_DEFINITIONS)) {
      expect(definition.text.trim().startsWith("{{")).toBe(false);
      expect(definition.text.trim().endsWith("}}")).toBe(false);
      expect(definition.text.match(/\{\{\d\}\}/g)?.length).toBe(counts[key as keyof typeof counts]);
      expect(definition.example.length).toBe(counts[key as keyof typeof counts]);
    }
  });
  it("reports approved, pending and missing templates", async () => {
    const fetcher = (async () => json({ data: [{ name: "rooster_gepubliceerd", status: "APPROVED", language: "nl" }, { name: "beschikbaarheid_opvragen", status: "PENDING", language: "nl" }] })) as typeof fetch;
    const result = await templateStatus(setup, fetcher);
    expect(result.ok && result.data.map((row) => row.status)).toEqual(["APPROVED", "PENDING", "MISSING"]);
  });
  it("submits a Utility template in Dutch with examples", async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => { sent = { url, body: JSON.parse(String(init.body)) }; return json({ id: "1", status: "PENDING" }); }) as unknown as typeof fetch;
    const result = await createTemplate(setup, "availability", fetcher);
    expect(result.ok).toBe(true);
    expect(sent!.url).toContain("/9876543210/message_templates");
    expect(sent!.body).toMatchObject({ name: "beschikbaarheid_opvragen", language: "nl", category: "UTILITY" });
  });
  it("passes Meta's own error message through", async () => {
    const fetcher = (async () => json({ error: { message: "Invalid OAuth access token", code: 190 } }, 401)) as typeof fetch;
    const result = await templateStatus(setup, fetcher);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Invalid OAuth");
  });
  it("connects the webhook with the app token, then subscribes the business account", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => { calls.push(`${init.method} ${url} ${init.body instanceof URLSearchParams ? init.body.get("callback_url") : ""}`); return json({ success: true }); }) as unknown as typeof fetch;
    const result = await connectWebhook(setup, "https://cliniq.example/api/whatsapp/webhook", fetcher);
    expect(result.ok).toBe(true);
    expect(calls[0]).toContain("/1122334455/subscriptions https://cliniq.example/api/whatsapp/webhook");
    expect(calls[1]).toContain("/9876543210/subscribed_apps");
  });
});
