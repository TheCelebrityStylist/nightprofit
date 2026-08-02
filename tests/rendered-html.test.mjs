import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), {
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
  assert.match(html, /Interactieve demo/);
  assert.match(html, /Volgende beste actie/);
  assert.match(html, /Operationele tijdlijn/);
  assert.match(html, /Alle data is synthetisch/);
});
