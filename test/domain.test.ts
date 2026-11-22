import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areaGaps,
  can,
  closeReferral,
  compareScenario,
  completionMetrics,
  gapIndex,
  isEligible,
  isOverdue,
  languageMatches,
  PROTOTYPE_AREA_NEED,
  rankProviders,
  recordDisposition,
  reviewPriority,
  reviewQueue,
  saveIntake,
  seedWorkspace,
  sendReferral,
  verifiedSlots,
} from "../src/domain/index.ts";
import { addFollowUpEvent } from "../src/domain/workflow.ts";
import type { Clock } from "../src/domain/types.ts";

const clock: Clock = { asOf: "2026-11-22", now: "2026-11-22T12:00:00.000Z" };

describe("prototype seed", () => {
  const workspace = seedWorkspace(clock.asOf);

  it("keeps the two-area gaps from verified capacity", () => {
    assert.deepEqual(areaGaps(workspace.providers, PROTOTYPE_AREA_NEED, clock.asOf), [
      { area: "Area A", demand: 200, slots: 120, gap: 40 },
      { area: "Area B", demand: 100, slots: 80, gap: 20 },
    ]);
  });

  it("moves the gaps when need comes from the March forecast points", () => {
    const needs = [
      { name: "Area A", demand: 225 },
      { name: "Area B", demand: 116 },
    ];
    assert.deepEqual(
      areaGaps(workspace.providers, needs, clock.asOf).map((gap) => gap.gap),
      [47, 31],
    );
  });

  it("drops capacity that was verified more than 7 days ago", () => {
    const providers = workspace.providers.map((provider) =>
      provider.id === "north" ? { ...provider, verified: "2026-11-14" } : provider,
    );
    assert.equal(verifiedSlots(providers, "Area A", clock.asOf), 0);
    assert.equal(gapIndex(200, 0), 100);
  });

  it("measures 30-day completion as 1 of 2 mature referrals", () => {
    const metrics = completionMetrics(workspace.referrals, clock.asOf);
    assert.equal(metrics.eligible, 2);
    assert.equal(metrics.confirmed, 1);
    assert.equal(metrics.unknown, 1);
    assert.equal(metrics.rateLabel, "50%");
  });

  it("marks open referrals past due", () => {
    const overdue = workspace.referrals.filter((referral) => isOverdue(referral, clock.asOf)).map((referral) => referral.id);
    assert.deepEqual(overdue, ["RF-201", "RF-203"]);
  });
});

describe("referral matching", () => {
  const workspace = seedWorkspace(clock.asOf);

  it("matches language tokens and refuses a substring hit", () => {
    assert.equal(languageMatches("English, Spanish", "English"), true);
    assert.equal(languageMatches("English Creole", "English"), false);
  });

  it("ranks the Medicaid English case to Northside only", () => {
    const record = workspace.records.find((item) => item.id === "BH-1043")!;
    const ranked = rankProviders(record, workspace.providers, clock.asOf);
    assert.deepEqual(
      ranked.map((provider) => [provider.id, isEligible(record, provider, clock.asOf)]),
      [
        ["north", true],
        ["east", false],
        ["bridge", false],
      ],
    );
  });

  it("leaves the urgent case with no eligible provider", () => {
    const record = workspace.records.find((item) => item.id === "BH-1045")!;
    assert.equal(rankProviders(record, workspace.providers, clock.asOf).some((provider) => isEligible(record, provider, clock.asOf)), false);
  });
});

describe("clinical review", () => {
  const workspace = seedWorkspace(clock.asOf);

  it("sorts urgent submissions ahead of routine ones", () => {
    assert.deepEqual(reviewQueue(workspace.records).map((record) => record.id), ["BH-1045", "BH-1041"]);
    assert.equal(reviewPriority(workspace.records.find((record) => record.id === "BH-1045")!), "Urgent human review");
    assert.equal(reviewPriority(workspace.records.find((record) => record.id === "BH-1041")!), "Routine review");
  });

  it("refuses to approve an urgent case", () => {
    const result = recordDisposition(workspace, "BH-1045", { status: "Approved", reason: "Looks stable." }, "Clinical reviewer", clock);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, "Urgent cases cannot be approved.");
  });

  it("blocks intake staff from recording a disposition", () => {
    const result = recordDisposition(workspace, "BH-1041", { status: "Approved", reason: "Reviewed." }, "Intake staff", clock);
    assert.equal(result.ok, false);
  });
});

describe("intake and referral writes", () => {
  it("rejects an anxiety score above 21 and accepts a depression score of 22", () => {
    const workspace = seedWorkspace(clock.asOf);
    const base = {
      token: "DEMO-047",
      encounter: "2026-11-22",
      area: "Area A" as const,
      payer: "Medicaid" as const,
      language: "English" as const,
      urgent: false,
      consent: true,
      intent: "Submitted" as const,
    };
    const anxiety = saveIntake(workspace, null, { ...base, need: "Anxiety", score: 22 }, "Intake staff", clock);
    assert.equal(anxiety.ok, false);
    const depression = saveIntake(workspace, null, { ...base, need: "Depression", score: 22 }, "Intake staff", clock);
    assert.equal(depression.ok, true);
    if (depression.ok) {
      const created = depression.workspace.records[0];
      assert.equal(created.instrument, "Example screening v1");
      assert.equal(created.id, "BH-1047");
    }
  });

  it("requires a score or an urgent flag before submit", () => {
    const result = saveIntake(
      seedWorkspace(clock.asOf),
      null,
      {
        token: "DEMO-048",
        encounter: "2026-11-22",
        area: "Area A",
        need: "Depression",
        payer: "Medicaid",
        language: "English",
        score: null,
        urgent: false,
        consent: true,
        intent: "Submitted",
      },
      "Intake staff",
      clock,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, "Enter a score or flag the case for urgent review.");
  });

  it("sends a referral only when the coordinator confirms an eligible provider", () => {
    const workspace = seedWorkspace(clock.asOf);
    const denied = sendReferral(
      workspace,
      "BH-1046",
      { providerId: "bridge", owner: "Casey Morgan", due: "2026-11-25", confirmed: true },
      "Care coordinator",
      clock,
    );
    assert.equal(denied.ok, false);
    const stillOpen = sendReferral(
      workspace,
      "BH-1046",
      { providerId: "north", owner: "Casey Morgan", due: "2026-11-25", confirmed: true },
      "Care coordinator",
      clock,
    );
    assert.equal(stillOpen.ok, false);
    const sent = sendReferral(
      workspace,
      "BH-1044",
      { providerId: "east", owner: "Jordan Lee", due: "2026-11-25", confirmed: true },
      "Care coordinator",
      clock,
    );
    assert.equal(sent.ok, true);
    if (sent.ok) assert.equal(sent.recordId, "RF-204");
  });
});

describe("follow-up lock", () => {
  it("keeps verified attendance as the only closure once it is recorded", () => {
    const workspace = seedWorkspace(clock.asOf);
    const recorded = addFollowUpEvent(
      workspace,
      "RF-201",
      { type: "Verified attendance", when: "2026-11-20", note: "Front desk confirmed", due: "2026-11-25" },
      "Care coordinator",
      clock,
    );
    assert.equal(recorded.ok, true);
    if (!recorded.ok) return;
    const wrong = closeReferral(
      recorded.workspace,
      "RF-201",
      { outcome: "Declined", reason: "Changed our minds." },
      "Care coordinator",
      clock,
    );
    assert.equal(wrong.ok, false);
    const closed = closeReferral(
      recorded.workspace,
      "RF-201",
      { outcome: "Verified attendance", reason: "Attendance confirmed." },
      "Care coordinator",
      clock,
    );
    assert.equal(closed.ok, true);
  });

  it("rejects an event dated before the previous one", () => {
    const result = addFollowUpEvent(
      seedWorkspace(clock.asOf),
      "RF-203",
      { type: "Contact attempted", when: "2026-11-01", note: "Called the clinic", due: "2026-11-25" },
      "Care coordinator",
      clock,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, "Enter an event date on or after the last recorded event.");
  });
});

describe("capacity scenario", () => {
  it("compares added slots with the monthly budget", () => {
    const within = compareScenario({ need: 200, currentSlots: 120, additionalSlots: 30, unitCost: 120, budget: 5000 });
    assert.deepEqual(within, {
      baselineGap: 40,
      scenarioGap: 25,
      unmetSlotsAvoided: 30,
      incrementalCost: 3600,
      withinBudget: true,
    });
    const over = compareScenario({ need: 200, currentSlots: 120, additionalSlots: 50, unitCost: 120, budget: 5000 });
    assert.equal(over.withinBudget, false);
  });
});

describe("roles", () => {
  it("gives the demo operator every screen and the planner none of the chart", () => {
    assert.equal(can("Demo operator", "Governance"), true);
    assert.equal(can("Network planner", "Intake"), false);
    assert.equal(can("Administrator", "Outcomes"), true);
    assert.equal(can("Administrator", "Clinical review"), false);
  });
});
