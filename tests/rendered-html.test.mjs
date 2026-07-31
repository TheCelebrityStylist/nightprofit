import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/", { cookie } = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}-${cookie ?? ""}`);
  const { default: worker } = await import(workerUrl.href);
  const headers = { accept: "text/html" };
  if (cookie) headers.cookie = cookie;
  return worker.fetch(new Request(`http://localhost${path}`, { headers }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: {},
    DOCUMENTS: {},
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the branded public experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>NightProfit — Profit control for nightlife<\/title>/i);
  assert.match(html, /Zie waar je winst verdwijnt/);
  assert.match(html, /Start winstdiagnose/);
  assert.match(html, /EXACTE GELDBEREKENING/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("server-renders the synthetic demo route", async () => {
  const response = await render("/demo");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /SYNTHETISCHE DEMO/);
  assert.match(html, /DAGELIJKSE OWNER BRIEFING/);
  assert.match(html, /Onverklaard verschil/);
  assert.match(html, /Alle getoonde data is fictief/);
});

test("renders the sign-in screen in Dutch by default", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html lang="nl"/);
  assert.match(html, /Welkom terug/);
  assert.match(html, /Inloggen/);
  assert.doesNotMatch(html, /Welcome back/);
});

test("renders the sign-in screen in English when the locale cookie is set", async () => {
  const response = await render("/login", { cookie: "np_locale=en" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html lang="en"/);
  assert.match(html, /Welcome back/);
  assert.match(html, /Sign in/);
  assert.doesNotMatch(html, /Welkom terug/);
});
