import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareScenario } from "../src/domain/planning.ts";
import { seedWorkspace } from "../src/domain/seed.ts";
import { updateCapacity } from "../src/domain/workflow.ts";
import { forecastPoints } from "../src/models/forecast.ts";
import { createContext, handleRequest } from "../src/server.ts";
import { workspaceView } from "../src/view.ts";

const asOf = "2026-11-22";
const clock = { asOf, now: "2026-11-22T12:00:00.000Z" };

describe("workspace view", () => {
  it("feeds the access gap from the first forecast month and keeps demand across a write", () => {
    const workspace = seedWorkspace(asOf);
    const view = workspaceView(workspace, "Demo operator", asOf);
    for (const series of workspace.demand) {
      const forecast = forecastPoints(series, series.originMonth, 4)[0];
      const gap = view.gaps.find((item) => item.area === series.area);
      assert.equal(gap?.demand, forecast.point);
    }
    const saved = updateCapacity(workspace, { providerId: "north", capacity: 150, verified: asOf }, "Administrator", clock);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.workspace.demand.length, 2);
    const after = workspaceView(saved.workspace, "Administrator", asOf);
    assert.equal(after.gaps[0].slots, 150);
    assert.equal(after.gaps[0].demand, view.gaps[0].demand);
    assert.notEqual(after.gaps[0].gap, view.gaps[0].gap);
  });

  it("publishes suppressed population counts and keeps the operational completion rate", () => {
    const view = workspaceView(seedWorkspace(asOf), "Network planner", asOf);
    assert.deepEqual(view.screens, ["Access gaps", "Demand forecast", "Capacity scenarios", "Outcomes"]);
    assert.equal(view.overview.completion.rateLabel, "50%");
    assert.equal(view.outcomes[0].rateLabel, "Suppressed");
    assert.equal(view.outcomes[0].referrals, null);
    assert.equal(view.reviewQueue.find((item) => item.id === "BH-1045")?.bhri.status, "abstain");
    assert.deepEqual(view.referrals.filter((referral) => referral.overdue).map((referral) => referral.id), ["RF-201", "RF-203"]);
  });
});

describe("state api", () => {
  it("serves the same gap the scenario route calculates", async () => {
    const ctx = createContext({ ...process.env, HF_TOKEN: "" });
    ctx.clock = clock;
    ctx.workspace = seedWorkspace(asOf);
    const stateResponse = await handleRequest(
      new Request("http://localhost/api/state", { headers: { "x-bhi-role": "Network planner" } }),
      ctx,
    );
    const state = await stateResponse.json();
    const gap = state.gaps[0];
    const scenarioResponse = await handleRequest(
      new Request("http://localhost/api/planning/scenario", {
        method: "POST",
        headers: { "content-type": "application/json", "x-bhi-role": "Network planner" },
        body: JSON.stringify({ area: gap.area, additionalSlots: 30, unitCost: 120, budget: 5000 }),
      }),
      ctx,
    );
    const scenario = await scenarioResponse.json();
    assert.deepEqual(scenario, compareScenario({ need: gap.demand, currentSlots: gap.slots, additionalSlots: 30, unitCost: 120, budget: 5000 }));
  });

  it("serves the workspace page", async () => {
    const ctx = createContext();
    const response = await handleRequest(new Request("http://localhost/"), ctx);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    assert.match(await response.text(), /BHI-CARE/);
  });

  it("opens a workspace session only with the synthetic access code", async () => {
    const ctx = createContext();
    const access = await handleRequest(new Request("http://localhost/api/access"), ctx);
    const catalog = await access.json();
    assert.equal(catalog.demoAccessCode, "care-demo");
    assert.ok(catalog.roles.includes("Care coordinator"));
    const denied = await handleRequest(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Alex", role: "Intake staff", accessCode: "nope" }),
      }),
      ctx,
    );
    assert.equal(denied.status, 401);
    const opened = await handleRequest(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Alex", role: "Intake staff", accessCode: catalog.demoAccessCode }),
      }),
      ctx,
    );
    assert.equal(opened.status, 200);
    assert.deepEqual(await opened.json(), { ok: true, name: "Alex", role: "Intake staff" });
  });
});
