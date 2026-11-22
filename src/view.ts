import { can, isEligible, rankProviders, reviewPriority, reviewQueue } from "./domain/access.ts";
import { areaGaps, completionMetrics, isOverdue, publishableCount, verifiedSlots } from "./domain/planning.ts";
import { baselinePoints, FORECAST_MODEL_ID, forecastPoints } from "./models/forecast.ts";
import { assessBhri } from "./models/bhri.ts";
import { modelConfig } from "./models/config.ts";
import {
  ACCESS_BARRIERS,
  COORDINATORS,
  INSTRUMENTS,
  ROLES,
  SCREENS,
  VALIDATION_STAGES,
  type Role,
  type Workspace,
} from "./domain/types.ts";
import { availableEvents, closureOptions, dispositionOptions } from "./domain/workflow.ts";

const GROUPS = [
  ["Care operations", ["Overview", "Intake", "Clinical review", "Referrals", "Follow-up"]],
  ["Population planning", ["Access gaps", "Demand forecast", "Capacity scenarios", "Outcomes"]],
  ["Administration", ["Governance"]],
] as const;

const FORECAST_HORIZON = 4;

function published(count: number): number | null {
  return publishableCount(count);
}

export function workspaceView(workspace: Workspace, role: Role, asOf: string) {
  const points = workspace.demand.flatMap((series) => forecastPoints(series, series.originMonth, FORECAST_HORIZON));
  const baseline = workspace.demand.flatMap((series) => baselinePoints(series, series.originMonth, FORECAST_HORIZON));
  const needs = workspace.demand.map((series) => {
    const next = points.find((point) => point.area === series.area);
    const demand = next && next.point > 0 ? next.point : series.values[series.values.length - 1];
    return { name: series.area, demand };
  });
  const gaps = areaGaps(workspace.providers, needs, asOf).map((gap) => ({
    ...gap,
    verified: workspace.providers
      .filter((provider) => provider.area === gap.area)
      .map((provider) => ({ id: provider.id, slots: verifiedSlots([provider], provider.area, asOf) })),
  }));
  const metrics = completionMetrics(workspace.referrals, asOf);
  const queue = reviewQueue(workspace.records);
  const config = modelConfig();

  const outcomes = ["All areas", ...workspace.demand.map((series) => series.area)].map((area) => {
    const referrals =
      area === "All areas"
        ? workspace.referrals
        : workspace.referrals.filter((referral) => workspace.records.find((record) => record.id === referral.caseId)?.area === area);
    const result = completionMetrics(referrals, asOf);
    return {
      area,
      referrals: published(referrals.length),
      eligible: published(result.eligible),
      confirmed: published(result.confirmed),
      unknown: published(result.unknown),
      overdue: published(referrals.filter((referral) => isOverdue(referral, asOf)).length),
      rateLabel: published(result.eligible) === null ? "Suppressed" : result.rateLabel,
    };
  });

  return {
    asOf,
    role,
    roles: ROLES,
    screens: SCREENS.filter((screen) => can(role, screen)),
    navigation: GROUPS.map(([label, screens]) => ({
      label,
      screens: screens.filter((screen) => can(role, screen)),
    })).filter((group) => group.screens.length > 0),
    instruments: INSTRUMENTS,
    coordinators: COORDINATORS,
    barriers: ACCESS_BARRIERS,
    validationStages: VALIDATION_STAGES,
    records: workspace.records,
    providers: workspace.providers,
    referrals: workspace.referrals.map((referral) => ({
      ...referral,
      providerName: workspace.providers.find((provider) => provider.id === referral.provider)?.name ?? referral.provider,
      overdue: isOverdue(referral, asOf),
      availableEvents: availableEvents(referral),
      closureOutcomes: referral.status === "Closed" ? [] : closureOptions(referral),
    })),
    readyCaseIds: workspace.records
      .filter(
        (record) =>
          record.status === "Approved" &&
          !workspace.referrals.some((referral) => referral.caseId === record.id && referral.status !== "Closed"),
      )
      .map((record) => record.id),
    matches: workspace.records
      .filter((record) => record.status === "Approved")
      .map((record) => ({
        caseId: record.id,
        providers: rankProviders(record, workspace.providers, asOf).map((provider) => ({
          id: provider.id,
          name: provider.name,
          capacity: provider.capacity,
          wait: provider.wait,
          travel: provider.travel,
          payer: provider.payer,
          language: provider.language,
          verified: provider.verified,
          eligible: isEligible(record, provider, asOf),
        })),
      })),
    reviewQueue: queue.map((record) => ({
      id: record.id,
      priority: reviewPriority(record),
      dispositions: dispositionOptions(record),
      bhri: assessBhri(record, config),
    })),
    overview: {
      pendingReview: workspace.records.filter((record) => record.status === "Submitted").length,
      openReferrals: workspace.referrals.filter((referral) => referral.status !== "Closed").length,
      overdue: workspace.referrals.filter((referral) => isOverdue(referral, asOf)).length,
      completion: metrics,
    },
    forecast: {
      model: FORECAST_MODEL_ID,
      series: workspace.demand,
      points,
      baseline,
    },
    gaps,
    outcomes,
    audit: workspace.audit,
  };
}
