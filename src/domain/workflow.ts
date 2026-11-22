import { can, isEligible } from "./access.ts";
import type {
  AreaName,
  Clock,
  EventType,
  Language,
  Need,
  Payer,
  Referral,
  Role,
  ScreeningCase,
  Workspace,
} from "./types.ts";
import { EVENT_TYPES, INSTRUMENTS } from "./types.ts";

const TOKEN = /^DEMO-[A-Za-z0-9-]+$/;
const ONCE: EventType[] = ["Accepted", "Scheduled", "Verified attendance"];

export type WorkflowResult =
  | { ok: true; workspace: Workspace; message: string; recordId: string }
  | { ok: false; message: string };

export interface IntakeInput {
  token: string;
  encounter: string;
  area: AreaName;
  need: Need;
  payer: Payer;
  language: Language;
  score: number | null;
  urgent: boolean;
  consent: boolean;
  intent: "Draft" | "Submitted";
}

export interface DispositionInput {
  status: "Approved" | "Returned" | "Escalated";
  reason: string;
}

function nextId(prefix: string, ids: string[], floor: number): string {
  const numbers = ids.map((id) => Number(id.split("-")[1]));
  return `${prefix}${Math.max(floor, ...numbers) + 1}`;
}

function commit(
  workspace: Workspace,
  next: Pick<Workspace, "records" | "providers" | "referrals">,
  message: string,
  recordId: string,
  role: Role,
  clock: Clock,
): WorkflowResult {
  return {
    ok: true,
    message,
    recordId,
    workspace: {
      ...workspace,
      ...next,
      audit: [{ id: recordId, time: clock.now, role, event: message }, ...workspace.audit],
    },
  };
}

function replaceRecord(workspace: Workspace, record: ScreeningCase): ScreeningCase[] {
  return workspace.records.map((item) => (item.id === record.id ? record : item));
}

export function saveIntake(
  workspace: Workspace,
  caseId: string | null,
  input: IntakeInput,
  role: Role,
  clock: Clock,
): WorkflowResult {
  if (!can(role, "Intake")) return { ok: false, message: "This role cannot change that record." };
  const current = caseId ? workspace.records.find((record) => record.id === caseId) : undefined;
  if (caseId && !current) return { ok: false, message: "Screening was not found." };
  if (current && !["Draft", "Returned"].includes(current.status)) {
    return { ok: false, message: "This screening can no longer be edited." };
  }
  if (input.need !== "Depression" && input.need !== "Anxiety") {
    return { ok: false, message: "Screening focus must be depression or anxiety." };
  }
  if (input.area !== "Area A" && input.area !== "Area B") {
    return { ok: false, message: "Service area must be Area A or Area B." };
  }
  if (!TOKEN.test(input.token)) return { ok: false, message: "Use a synthetic token such as DEMO-047." };
  if (input.encounter > clock.asOf) return { ok: false, message: "Encounter date cannot be in the future." };
  const instrument = INSTRUMENTS[input.need];
  if (input.score !== null && (input.score < instrument.min || input.score > instrument.max)) {
    return {
      ok: false,
      message: `${input.need} screening scores run from ${instrument.min} to ${instrument.max}.`,
    };
  }
  if (input.intent === "Submitted" && input.score === null && !input.urgent) {
    return { ok: false, message: "Enter a score or flag the case for urgent review." };
  }
  const duplicate = workspace.records.some(
    (record) =>
      record.id !== current?.id &&
      record.token === input.token &&
      record.encounter === input.encounter &&
      record.need === input.need,
  );
  if (duplicate) return { ok: false, message: "A matching screening already exists for this encounter." };

  const record: ScreeningCase = {
    ...current,
    ...input,
    id: current?.id ?? nextId("BH-", workspace.records.map((item) => item.id), 1046),
    score: input.score,
    urgent: input.urgent,
    consent: input.consent,
    status: input.intent,
    instrument: instrument.id,
    submitted: input.intent === "Submitted" ? clock.asOf : current?.submitted,
  };
  const records = current ? replaceRecord(workspace, record) : [record, ...workspace.records];
  const message = input.intent === "Submitted" ? "Screening submitted for clinical review." : "Intake draft saved.";
  return commit(workspace, { ...workspace, records }, message, record.id, role, clock);
}

export function recordDisposition(
  workspace: Workspace,
  caseId: string,
  input: DispositionInput,
  role: Role,
  clock: Clock,
): WorkflowResult {
  if (!can(role, "Clinical review")) return { ok: false, message: "This role cannot change that record." };
  const current = workspace.records.find((record) => record.id === caseId);
  if (!current || current.status !== "Submitted") {
    return { ok: false, message: "Only submitted screenings can be reviewed." };
  }
  if (current.urgent && input.status === "Approved") {
    return { ok: false, message: "Urgent cases cannot be approved." };
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 300) {
    return { ok: false, message: "Enter an assessment of 300 characters or fewer." };
  }
  const record: ScreeningCase = { ...current, status: input.status, reason, reviewed: clock.asOf };
  const message = `Disposition recorded: ${input.status}`;
  return commit(workspace, { ...workspace, records: replaceRecord(workspace, record) }, message, record.id, role, clock);
}

export function recordBarrier(
  workspace: Workspace,
  caseId: string,
  owner: string,
  barrier: string,
  role: Role,
  clock: Clock,
): WorkflowResult {
  if (!can(role, "Referrals")) return { ok: false, message: "This role cannot change that record." };
  const current = workspace.records.find((record) => record.id === caseId);
  if (!current || current.status !== "Approved") {
    return { ok: false, message: "Only an approved case can be referred." };
  }
  const record: ScreeningCase = { ...current, coordinator: owner, barrier };
  const message = "Coordinator assigned and access barrier recorded.";
  return commit(workspace, { ...workspace, records: replaceRecord(workspace, record) }, message, record.id, role, clock);
}

export function sendReferral(
  workspace: Workspace,
  caseId: string,
  input: { providerId: string; owner: string; due: string; confirmed: boolean },
  role: Role,
  clock: Clock,
): WorkflowResult {
  if (!can(role, "Referrals")) return { ok: false, message: "This role cannot change that record." };
  const current = workspace.records.find((record) => record.id === caseId);
  const provider = workspace.providers.find((item) => item.id === input.providerId);
  const openReferral = workspace.referrals.some((referral) => referral.caseId === caseId && referral.status !== "Closed");
  if (
    !current ||
    current.status !== "Approved" ||
    !provider ||
    !isEligible(current, provider, clock.asOf) ||
    !input.confirmed ||
    openReferral
  ) {
    return { ok: false, message: "Recheck patient agreement, eligibility, and availability." };
  }
  if (input.due < clock.asOf) return { ok: false, message: "Follow-up due date cannot be in the past." };
  const referral: Referral = {
    id: nextId("RF-", workspace.referrals.map((item) => item.id), 203),
    caseId: current.id,
    provider: provider.id,
    owner: input.owner,
    sent: clock.asOf,
    due: input.due,
    status: "Sent",
    events: [],
  };
  const message = "Referral sent and follow-up assigned.";
  return commit(
    workspace,
    { ...workspace, referrals: [referral, ...workspace.referrals] },
    message,
    referral.id,
    role,
    clock,
  );
}

export function availableEvents(referral: Referral): EventType[] {
  return EVENT_TYPES.filter((type) => !ONCE.includes(type) || !referral.events.some((event) => event.type === type));
}

export function addFollowUpEvent(
  workspace: Workspace,
  referralId: string,
  input: { type: EventType; when: string; note: string; due: string },
  role: Role,
  clock: Clock,
): WorkflowResult {
  if (!can(role, "Follow-up")) return { ok: false, message: "This role cannot change that record." };
  const current = workspace.referrals.find((referral) => referral.id === referralId);
  if (!current || current.status === "Closed") return { ok: false, message: "This referral is already closed." };
  if (!availableEvents(current).includes(input.type)) {
    return { ok: false, message: "This event is already on the timeline." };
  }
  const note = input.note.trim();
  if (!note || note.length > 150) return { ok: false, message: "Enter a source note of 150 characters or fewer." };
  if (input.when < current.sent || input.when > clock.asOf) {
    return { ok: false, message: "Enter an event date on or after the referral was sent." };
  }
  const last = current.events.at(-1)?.when;
  if (last && last > input.when) {
    return { ok: false, message: "Enter an event date on or after the last recorded event." };
  }
  if (current.events.some((event) => event.type === input.type && event.when === input.when && event.note === note)) {
    return { ok: false, message: "This event already exists." };
  }
  if (input.due < clock.asOf) return { ok: false, message: "Follow-up due date cannot be in the past." };
  const referral: Referral = {
    ...current,
    events: [...current.events, { type: input.type, when: input.when, note }],
    due: input.due,
    status: "Follow-up",
  };
  const referrals = workspace.referrals.map((item) => (item.id === referral.id ? referral : item));
  return commit(workspace, { ...workspace, referrals }, `${input.type} recorded.`, referral.id, role, clock);
}

const CLOSURE_OUTCOMES = ["Verified attendance", "Declined", "Unable to reach", "Redirected", "Outcome unknown"] as const;
export type ClosureOutcome = (typeof CLOSURE_OUTCOMES)[number];

export function closureOptions(referral: Referral): ClosureOutcome[] {
  if (referral.events.some((event) => event.type === "Verified attendance")) return ["Verified attendance"];
  return ["Declined", "Unable to reach", "Redirected", "Outcome unknown"];
}

export function dispositionOptions(record: ScreeningCase): Array<"Approved" | "Returned" | "Escalated"> {
  return record.urgent ? ["Escalated", "Returned"] : ["Approved", "Returned", "Escalated"];
}

export function closeReferral(
  workspace: Workspace,
  referralId: string,
  input: { outcome: ClosureOutcome; reason: string },
  role: Role,
  clock: Clock,
): WorkflowResult {
  if (!can(role, "Follow-up")) return { ok: false, message: "This role cannot change that record." };
  const current = workspace.referrals.find((referral) => referral.id === referralId);
  if (!current || current.status === "Closed") return { ok: false, message: "This referral is already closed." };
  const verified = current.events.some((event) => event.type === "Verified attendance");
  if (input.outcome === "Verified attendance" && !verified) {
    return { ok: false, message: "Verified attendance is not on the timeline." };
  }
  if (verified && input.outcome !== "Verified attendance") {
    return { ok: false, message: "Verified attendance is already documented for this referral." };
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 300) {
    return { ok: false, message: "Enter a closure rationale of 300 characters or fewer." };
  }
  const referral: Referral = {
    ...current,
    status: "Closed",
    outcome: input.outcome,
    closed: clock.asOf,
    closureReason: reason,
  };
  const referrals = workspace.referrals.map((item) => (item.id === referral.id ? referral : item));
  const message = `Referral closed: ${input.outcome}`;
  return commit(workspace, { ...workspace, referrals }, message, referral.id, role, clock);
}

export function updateCapacity(
  workspace: Workspace,
  input: { providerId: string; capacity: number; verified: string },
  role: Role,
  clock: Clock,
): WorkflowResult {
  if (!can(role, "Governance")) return { ok: false, message: "This role cannot change that record." };
  const current = workspace.providers.find((provider) => provider.id === input.providerId);
  if (!current) return { ok: false, message: "Provider was not found." };
  if (input.capacity < 0 || input.capacity > 10000) {
    return { ok: false, message: "Monthly slots must be between 0 and 10000." };
  }
  if (input.verified > clock.asOf) return { ok: false, message: "Verification date cannot be in the future." };
  const provider = { ...current, capacity: input.capacity, verified: input.verified };
  const providers = workspace.providers.map((item) => (item.id === provider.id ? provider : item));
  const message = "Provider capacity updated.";
  return commit(workspace, { ...workspace, providers }, message, provider.id, role, clock);
}
