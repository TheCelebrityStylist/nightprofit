import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync(new URL("../app/roster-board.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/real-app.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");

describe("roster-first planning experience", () => {
  it("uses one concise planning title and truthful empty-state language", () => {
    expect(board).toContain('tx("Rooster", "Roster")');
    expect(board).toContain('tx("Forecast ontbreekt", "Forecast missing")');
    expect(board).toContain('tx("Nog geen diensten", "No shifts yet")');
    expect(board).toContain('tx("Rooster nog niet klaar", "Roster not ready")');
    expect(shell).toContain('path !== "/app/planning"');
  });

  it("moves advanced information behind contextual interactions", () => {
    expect(board).toContain('setPanel("health")');
    expect(board).toContain('setPanel("scenario")');
    expect(css).toContain(".roster-product>.workforce-inbox");
    expect(css).toContain(".roster-product>.coverage-layer");
    expect(css).toContain("display:none");
  });

  it("uses a dedicated mobile day roster instead of squeezing the week grid", () => {
    expect(board).toContain('className="mobile-day-roster"');
    expect(css).toContain(".mobile-day-roster{display:none}");
    expect(css).toContain(".roster-board,.day-planner,.month-planner{display:none!important}");
  });

  it("preserves the existing persisted planner mutations", () => {
    for (const action of [
      "shift_update",
      "shift_duplicate",
      "shift_lock",
      "shift_cancel",
      "proposal_apply",
      "publish",
      "copy_week",
    ]) expect(board).toContain(`\"${action}\"`);
  });
});
