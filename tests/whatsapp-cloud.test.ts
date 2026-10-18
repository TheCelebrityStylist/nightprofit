import { describe, expect, it } from "vitest";
import { cleanParam, sendTemplate, statusUpdates, templateMessage, verifySignature, type WhatsappConfig } from "../lib/whatsapp/cloud";

const config: WhatsappConfig = { token: "test-token", phoneNumberId: "1234567890", graphVersion: "v23.0", language: "nl", templates: { roster: "rooster_gepubliceerd", availability: "beschikbaarheid_opvragen", invite: "team_uitnodiging" } };

describe("WhatsApp Cloud API", () => {
  it("flattens values Meta would reject", () => {
    expect(cleanParam("do 22 okt 21:30-02:00\nvr 23 okt 23:00-03:00")).toBe("do 22 okt 21:30-02:00 · vr 23 okt 23:00-03:00");
    expect(cleanParam("a\t\tb      c")).toBe("a · b c");
    expect(cleanParam("")).toBe("-");
    expect(cleanParam("x".repeat(900)).length).toBe(700);
  });

  it("builds a template message for a Dutch mobile number", () => {
    const body = templateMessage("+31612345678", "rooster_gepubliceerd", "nl", ["Sam", "Cliniq", "43", "vr 23 okt 23:00-03:00", "4"]);
    expect(body.to).toBe("31612345678");
    expect(body.template.name).toBe("rooster_gepubliceerd");
    expect(body.template.language.code).toBe("nl");
    expect(body.template.components[0].parameters).toHaveLength(5);
    expect(() => templateMessage("12", "x", "nl", [])).toThrow();
  });

  it("reports the message id on success and a plain reason on failure", async () => {
    const ok = await sendTemplate(config, "+31612345678", "roster", ["a"], (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 })) as typeof fetch);
    expect(ok).toEqual({ ok: true, messageId: "wamid.1" });
    const missingTemplate = await sendTemplate(config, "+31612345678", "roster", ["a"], (async () => new Response(JSON.stringify({ error: { code: 132001, message: "Template name does not exist" } }), { status: 404 })) as typeof fetch);
    expect(missingTemplate.ok).toBe(false);
    if (!missingTemplate.ok) expect(missingTemplate.detail).toContain("niet goedgekeurd");
    const badNumber = await sendTemplate(config, "abc", "roster", ["a"]);
    expect(badNumber.ok).toBe(false);
  });

  it("accepts only correctly signed webhooks", async () => {
    const secret = "app-secret";
    const body = JSON.stringify({ entry: [] });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(await verifySignature(secret, body, `sha256=${signature}`)).toBe(true);
    expect(await verifySignature(secret, body + " ", `sha256=${signature}`)).toBe(false);
    expect(await verifySignature(secret, body, null)).toBe(false);
  });

  it("reads delivery receipts from a webhook payload", () => {
    const updates = statusUpdates({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered" }, { id: "wamid.2", status: "failed", errors: [{ code: 131026, title: "Undeliverable" }] }, { id: "wamid.3", status: "deleted" }] } }] }] });
    expect(updates).toEqual([
      { messageId: "wamid.1", state: "delivered", failureReason: null },
      { messageId: "wamid.2", state: "failed", failureReason: "Dit nummer heeft geen WhatsApp of kan dit bericht niet ontvangen." },
    ]);
  });
});
