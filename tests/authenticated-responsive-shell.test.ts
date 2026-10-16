import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(
  new URL("../app/authenticated-app.tsx", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const productCss = readFileSync(
  new URL("../app/real-app.css", import.meta.url),
  "utf8",
);

describe("authenticated responsive shell", () => {
  it("renders semantic links for every authenticated navigation destination", () => {
    expect(shell).toContain('<nav aria-label="NightProfit">');
    expect(shell).toContain("<Link");
    expect(shell).toContain('className={path === href ? "active" : ""}');
  });

  it("gives authenticated navigation links accessible touch targets", () => {
    expect(globalCss).toContain(".real-app aside nav a{");
    expect(globalCss).toContain("min-height:44px");
  });

  it("keeps authenticated navigation reachable as a mobile bottom bar", () => {
    expect(globalCss).toContain(
      ".real-app aside{inset:auto 0 0;width:auto;height:68px",
    );
    expect(globalCss).toContain(".real-app aside nav{width:max-content");
    expect(globalCss).toContain(".real-app .app-main{padding-bottom:68px}");
  });

  it("keeps week navigation controls at least 44 pixels square", () => {
    expect(productCss).toContain(
      ".week-switch button{min-width:44px;min-height:44px}",
    );
  });
});
