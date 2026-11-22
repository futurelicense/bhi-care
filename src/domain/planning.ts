import { daysBetween } from "./dates.ts";
import type { Provider, Referral } from "./types.ts";
import { SMALL_CELL_MINIMUM } from "./types.ts";

export function gapIndex(need: number, slots: number): number {
  if (!(need > 0)) throw new Error("Estimated need must be greater than zero.");
  return Math.max(0, Math.round(100 * (1 - slots / need)));
}

export function verifiedSlots(providers: Provider[], area: string, asOf: string): number {
  return providers
    .filter((provider) => provider.area === area && daysBetween(provider.verified, asOf) <= 7)
    .reduce((total, provider) => total + provider.capacity, 0);
}

export function areaGaps(
  providers: Provider[],
  needs: { name: string; demand: number }[],
  asOf: string,
): { area: string; demand: number; slots: number; gap: number }[] {
  return needs.map((area) => {
    const slots = verifiedSlots(providers, area.name, asOf);
    return { area: area.name, demand: area.demand, slots, gap: gapIndex(area.demand, slots) };
  });
}

export interface ScenarioInput {
  need: number;
  currentSlots: number;
  additionalSlots: number;
  unitCost: number;
  budget: number;
}

export interface ScenarioResult {
  baselineGap: number;
  scenarioGap: number;
  unmetSlotsAvoided: number;
  incrementalCost: number;
  withinBudget: boolean;
}

export function compareScenario(input: ScenarioInput): ScenarioResult {
  const incrementalCost = input.additionalSlots * input.unitCost;
  return {
    baselineGap: gapIndex(input.need, input.currentSlots),
    scenarioGap: gapIndex(input.need, input.currentSlots + input.additionalSlots),
    unmetSlotsAvoided: Math.min(input.additionalSlots, Math.max(0, input.need - input.currentSlots)),
    incrementalCost,
    withinBudget: incrementalCost <= input.budget,
  };
}

export function isOverdue(referral: Referral, asOf: string): boolean {
  return referral.status !== "Closed" && referral.due < asOf;
}

export interface CompletionMetrics {
  eligible: number;
  confirmed: number;
  unknown: number;
  rate: number | null;
  rateLabel: string;
}

export function completionMetrics(referrals: Referral[], asOf: string): CompletionMetrics {
  const eligible = referrals.filter((referral) => daysBetween(referral.sent, asOf) >= 30);
  const confirmed = eligible.filter((referral) =>
    referral.events.some(
      (event) =>
        event.type === "Verified attendance" &&
        daysBetween(referral.sent, event.when) >= 0 &&
        daysBetween(referral.sent, event.when) <= 30,
    ),
  );
  const unknown = eligible.filter(
    (referral) =>
      !referral.events.some((event) => event.type === "Verified attendance") &&
      (referral.status !== "Closed" || referral.outcome === "Outcome unknown"),
  );
  const rate = eligible.length ? Math.round((100 * confirmed.length) / eligible.length) : null;
  return {
    eligible: eligible.length,
    confirmed: confirmed.length,
    unknown: unknown.length,
    rate,
    rateLabel: rate === null ? "—" : `${rate}%`,
  };
}

export function publishableCount(count: number, minimum = SMALL_CELL_MINIMUM): number | null {
  return count < minimum ? null : count;
}
