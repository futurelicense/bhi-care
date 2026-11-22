import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedWorkspace } from "../src/domain/seed.ts";
import { assessBhri } from "../src/models/bhri.ts";
import { modelConfig } from "../src/models/config.ts";
import { draftNote } from "../src/models/draft.ts";
import { baselinePoints, FORECAST_MODEL_ID, forecastPoints, seasonalNaive } from "../src/models/forecast.ts";
import { handleRequest, type ServerContext } from "../src/server.ts";

const config = modelConfig({});

function context(patch: Partial<ServerContext> = {}): ServerContext {
  const asOf = "2026-11-22";
  return {
    workspace: seedWorkspace(asOf),
    clock: { asOf, now: "2026-11-22T12:00:00.000Z" },
    config,
    fetch: async () => new Response("{}"),
    ...patch,
  };
}

function post(path: string, body: unknown, role?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(role ? { "x-bhi-role": role } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("BHRI", () => {
  it("abstains for urgent, missing, and routine cases and never returns an index", () => {
    const workspace = seedWorkspace("2026-11-22");
    for (const id of ["BH-1045", "BH-1041"]) {
      const result = assessBhri(workspace.records.find((record) => record.id === id)!, config);
      assert.equal(result.status, "abstain");
      assert.equal("score" in result, false);
    }
    const configured = assessBhri(workspace.records[0], modelConfig({ HF_MODEL_BHRI: "org/bhri-private" }));
    assert.equal(configured.status, "abstain");
    assert.equal(configured.model, "org/bhri-private");
  });
});

describe("drafts", () => {
  it("does not call Hugging Face for an urgent case", async () => {
    let called = false;
    const result = await draftNote(
      { kind: "rationale", urgent: true, facts: { caseId: "BH-1045" } },
      modelConfig({ HF_TOKEN: "hf_test" }),
      async () => {
        called = true;
        return new Response("{}");
      },
    );
    assert.equal(called, false);
    assert.equal(result.ok, false);
  });

  it("sends facts to the default Qwen model and keeps the draft", async () => {
    let body = "";
    const result = await draftNote(
      { kind: "match-note", facts: { provider: "Northside Behavioral Health", waitDays: 8 } },
      modelConfig({ HF_TOKEN: "hf_test" }),
      async (_url, init) => {
        body = String(init?.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"draft":"Northside has 8 wait days."}' } }] }));
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.model, "Qwen/Qwen2.5-7B-Instruct");
    assert.match(body, /Qwen\/Qwen2\.5-7B-Instruct/);
    assert.match(body, /Northside Behavioral Health/);
  });

  it("refuses population notes built from small cells", async () => {
    const result = await draftNote(
      { kind: "outcomes", facts: { confirmed: 1, eligible: 2 } },
      modelConfig({ HF_TOKEN: "hf_test" }),
    );
    assert.equal(result.ok, false);
  });
});

describe("forecast contract", () => {
  it("keeps the seasonal naive baseline beside the smoothing model", () => {
    assert.deepEqual(seasonalNaive([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130], 2), [20, 30]);
    assert.deepEqual(baselinePoints({ area: "Area A", values: [200] }, "2026-11", 1), [
      { area: "Area A", month: "2026-12", point: 200, low: 200, high: 200 },
    ]);
  });

  it("projects a short linear series and a flat two-year series inside the function", () => {
    assert.deepEqual(forecastPoints({ area: "Area A", values: [200, 208] }, "2026-11", 1), [
      { area: "Area A", month: "2026-12", point: 216, low: 216, high: 216 },
    ]);
    const flat = forecastPoints({ area: "Area B", values: Array(24).fill(100) }, "2026-11", 2);
    assert.deepEqual(
      flat.map((point) => point.point),
      [100, 100],
    );
    assert.ok(flat.every((point) => point.low <= point.point && point.point <= point.high));
  });

  it("repeats the first season when each month has been seen once", () => {
    const values = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210];
    assert.equal(forecastPoints({ area: "Area A", values }, "2026-11", 1)[0].point, 100);
  });
});

describe("http", () => {
  it("reports the default models and abstain BHRI", async () => {
    const response = await handleRequest(new Request("http://localhost/api/health"), context());
    assert.deepEqual(await response.json(), {
      ok: true,
      forecastModel: "bhi/seasonal-smoothing-v1",
      draftModel: "Qwen/Qwen2.5-7B-Instruct",
      bhri: "abstain",
    });
  });

  it("refuses a planner who tries to file an intake", async () => {
    const response = await handleRequest(
      post("/api/intake", { token: "DEMO-099", encounter: "2026-11-22", area: "Area A", need: "Depression", payer: "Medicaid", language: "English", score: 4, urgent: false, consent: true, intent: "Submitted" }, "Network planner"),
      context(),
    );
    assert.equal(response.status, 403);
  });

  it("forecasts without a Hugging Face token", async () => {
    const response = await handleRequest(
      post("/api/models/forecast", { originMonth: "2026-11", horizon: 1, series: [{ area: "Area A", values: [200, 208] }] }, "Network planner"),
      context(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      model: FORECAST_MODEL_ID,
      points: [{ area: "Area A", month: "2026-12", point: 216, low: 216, high: 216 }],
    });
  });
});
