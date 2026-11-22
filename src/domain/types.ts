export const ROLES = [
  "Demo operator",
  "Intake staff",
  "Clinical reviewer",
  "Care coordinator",
  "Network planner",
  "Administrator",
] as const;

export type Role = (typeof ROLES)[number];

export const SCREENS = [
  "Overview",
  "Intake",
  "Clinical review",
  "Referrals",
  "Follow-up",
  "Access gaps",
  "Demand forecast",
  "Capacity scenarios",
  "Outcomes",
  "Governance",
] as const;

export type Screen = (typeof SCREENS)[number];

export type CaseStatus = "Draft" | "Returned" | "Submitted" | "Approved" | "Escalated";
export type Need = "Depression" | "Anxiety";
export type Payer = "Medicaid" | "Commercial";
export type Language = "English" | "Spanish";
export type AreaName = "Area A" | "Area B";

export interface ScreeningCase {
  id: string;
  token: string;
  area: AreaName;
  need: Need;
  payer: Payer;
  language: Language;
  score: number | null;
  status: CaseStatus;
  encounter: string;
  instrument: string;
  consent: boolean;
  urgent?: boolean;
  reason?: string;
  reviewed?: string;
  submitted?: string;
  coordinator?: string;
  barrier?: string;
}

export interface Provider {
  id: string;
  name: string;
  area: AreaName;
  service: string;
  payer: Payer;
  language: string;
  capacity: number;
  wait: number;
  travel: number;
  verified: string;
}

export type ReferralStatus = "Sent" | "Follow-up" | "Closed";

export const EVENT_TYPES = [
  "Contact attempted",
  "Accepted",
  "Scheduled",
  "Verified attendance",
  "Declined",
  "Outcome unknown",
  "Barrier recorded",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ReferralEvent {
  type: EventType;
  when: string;
  note: string;
}

export interface Referral {
  id: string;
  caseId: string;
  provider: string;
  owner: string;
  sent: string;
  due: string;
  status: ReferralStatus;
  events: ReferralEvent[];
  outcome?: string;
  closed?: string;
  closureReason?: string;
}

export interface AuditEntry {
  id: string;
  time: string;
  role: Role;
  event: string;
}

export interface DemandSeries {
  area: AreaName;
  originMonth: string;
  values: number[];
}

export interface Workspace {
  records: ScreeningCase[];
  providers: Provider[];
  referrals: Referral[];
  demand: DemandSeries[];
  audit: AuditEntry[];
}

export const COORDINATORS = ["Casey Morgan", "Jordan Lee"] as const;

export const ACCESS_BARRIERS = [
  "Sharing agreement missing",
  "No verified capacity",
  "Payer or language mismatch",
  "Other access barrier",
] as const;

export interface Clock {
  asOf: string;
  now: string;
}

export const INSTRUMENTS: Record<Need, { id: string; min: 0; max: number }> = {
  Depression: { id: "Example screening v1", min: 0, max: 27 },
  Anxiety: { id: "Example screening v1 · anxiety", min: 0, max: 21 },
};

export const PROTOTYPE_AREA_NEED: { name: AreaName; demand: number }[] = [
  { name: "Area A", demand: 200 },
  { name: "Area B", demand: 100 },
];

export const VALIDATION_STAGES = [
  "Retrospective development and external validation",
  "Silent prospective testing",
  "Human-reviewed feasibility pilot",
  "Comparative evaluation",
  "Multisite transfer and recalibration",
] as const;

export const SMALL_CELL_MINIMUM = 11;
