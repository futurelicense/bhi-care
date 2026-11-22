import { daysBetween } from "./dates.ts";
import type { Provider, ScreeningCase } from "./types.ts";

const RIGHTS = {
  "Intake staff": ["Overview", "Intake"],
  "Clinical reviewer": ["Overview", "Clinical review"],
  "Care coordinator": ["Overview", "Referrals", "Follow-up"],
  "Network planner": ["Access gaps", "Demand forecast", "Capacity scenarios", "Outcomes"],
  Administrator: ["Governance", "Outcomes"],
} as const;

export function can(role: string, screen: string): boolean {
  if (role === "Demo operator") return true;
  const allowed = RIGHTS[role as keyof typeof RIGHTS] as readonly string[] | undefined;
  return allowed?.includes(screen) ?? false;
}

export function languageTokens(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export function languageMatches(providerLanguage: string, patientLanguage: string): boolean {
  const want = patientLanguage.trim();
  return languageTokens(providerLanguage).some((token) => token === want);
}

export function isEligible(record: ScreeningCase, provider: Provider, asOf: string): boolean {
  return (
    record.consent &&
    provider.capacity > 0 &&
    record.payer === provider.payer &&
    languageMatches(provider.language, record.language) &&
    daysBetween(provider.verified, asOf) <= 7
  );
}

export function accessScore(provider: Provider): number {
  return provider.wait + provider.travel / 10;
}

export function rankProviders(record: ScreeningCase, providers: Provider[], asOf: string): Provider[] {
  return [...providers].sort((a, b) => {
    const eligibility = Number(isEligible(record, b, asOf)) - Number(isEligible(record, a, asOf));
    if (eligibility !== 0) return eligibility;
    return accessScore(a) - accessScore(b);
  });
}

export type ReviewPriority = "Urgent human review" | "Model abstains" | "Routine review";

export function reviewPriority(record: ScreeningCase): ReviewPriority {
  if (record.urgent) return "Urgent human review";
  if (record.score === null) return "Model abstains";
  return "Routine review";
}

export function reviewQueue(records: ScreeningCase[]): ScreeningCase[] {
  return records
    .filter((record) => record.status === "Submitted")
    .sort(
      (a, b) =>
        Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) || a.encounter.localeCompare(b.encounter),
    );
}
