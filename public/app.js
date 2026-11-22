"use strict";

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("bhi-session") || "null");
    if (saved?.role && saved?.name) return saved;
  } catch {
    /* ignore a damaged session */
  }
  return null;
}

let session = readSession();
let page = "Overview";
let role = session?.role || "";
let selected = "";
let message = "";
let state = null;
let query = "";
let statusFilter = "";
let scenario = null;
let scenarioInput = { area: "Area A", slots: "30", unit: "120", budget: "5000" };
let gateView = "landing";
let gateMessage = "";
let access = null;
let publicStep = 0;
let tourIndex = -1;

const PUBLIC_TOUR = [
  ["Care pathway", "BHI-CARE follows one outpatient path: identify a need, review it, coordinate a service, verify attendance, then plan capacity."],
  ["Intake", "Intake staff record a synthetic token, the screening focus, and whether the person agreed to share referral information."],
  ["Clinical review", "Urgent cases go to a person first. BHRI abstains. The reviewer records Approved, Returned, or Escalated."],
  ["Referrals", "A provider is eligible only with consent, open slots, the same payer, a language match, and a recent capacity check."],
  ["Follow-up", "Coordinators record contact, scheduling, and verified attendance. A verified visit is the only closure once it is on the timeline."],
  ["Planning", "The forecast supplies next month's need. Access gaps and capacity scenarios use that need and the verified slots."],
];

const WORKSPACE_TOUR = [
  ["Overview", "Overview", "These counts are the live workspace: reviews waiting, open referrals, overdue follow-ups, and 30-day completion."],
  ["Intake", "Intake", "New screenings are saved here. Submit sends the case to clinical review."],
  ["Clinical review", "Clinical review", "Open a submitted case. The BHRI line abstains. Record the disposition yourself."],
  ["Referrals", "Referrals", "Approved cases with no open referral are ready to match. Eligibility is calculated on the server."],
  ["Follow-up", "Follow-up", "Record an event or close the referral. Overdue means the follow-up date has passed and the referral is still open."],
  ["Access gaps", "Access gaps", "Each area's need is the first forecast month. The bar is the share of that need still unmet."],
  ["Demand forecast", "Demand forecast", "The point and interval come from seasonal smoothing. The baseline column is the seasonal comparison."],
  ["Capacity scenarios", "Capacity scenarios", "Compare extra slots against the current gap. Cost is slots times the unit cost, checked against the budget."],
  ["Outcomes", "Outcomes", "Population counts below the small-cell minimum are suppressed on this page."],
  ["Governance", "Governance", "Updating a provider's verified slots changes the access gaps the next time this workspace loads."],
];

function workspaceSteps() {
  if (!state) return [];
  return WORKSPACE_TOUR.filter((step) => state.screens.includes(step[0])).map(([screen, title, body]) => ({ screen, title, body }));
}

const app = () => document.getElementById("app");
const tag = (text, warn = false) => `<span class="tag${warn ? " warn" : ""}">${esc(text)}</span>`;
const button = (text, attr, alt = false) => `<button type="button" class="btn${alt ? " alt" : ""}" ${attr}>${esc(text)}</button>`;
const options = (values, active = "") => values.map((value) => `<option${value === active ? " selected" : ""}>${esc(value)}</option>`).join("");
const select = (name, values, active = "") => `<select name="${name}">${options(values, active)}</select>`;
const field = (title, control) => `<label>${title}${control}</label>`;
const section = (title, sub) => `<div class="section-title"><h1>${esc(title)}</h1><p class="muted">${esc(sub)}</p></div>`;
const stat = (label, value, note) => `<div class="card stat"><span class="muted">${esc(label)}</span><b>${esc(value)}</b><span class="fine muted">${esc(note)}</span></div>`;
const table = (headers, rows) =>
  rows.length
    ? `<div class="scroll"><table><thead><tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`
    : `<p class="muted">No records match this view.</p>`;
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const recordById = (id) => state.records.find((record) => record.id === id);
const referralById = (id) => state.referrals.find((referral) => referral.id === id);

async function call(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-bhi-role": role },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

function go(next, id = "") {
  if (state && !state.screens.includes(next)) return;
  page = next;
  selected = id;
  query = "";
  statusFilter = "";
  scenario = null;
  message = "";
  tourIndex = -1;
  render();
}

function fillRole() {
  const select = document.getElementById("role");
  select.innerHTML = state.roles.map((item) => `<option${item === role ? " selected" : ""}>${esc(item)}</option>`).join("");
  const who = document.getElementById("who");
  if (who) who.textContent = session ? session.name : "";
}

function tourCard() {
  const steps = workspaceSteps();
  if (tourIndex < 0 || !steps.length) return "";
  const step = steps[Math.min(tourIndex, steps.length - 1)];
  return `<div class="card tour-card"><p class="muted">Tour ${tourIndex + 1} of ${steps.length}</p><h2>${esc(step.title)}</h2><p>${esc(step.body)}</p><div class="row">${tourIndex > 0 ? button("Back", 'data-act="tour-back"', true) : ""}${button(tourIndex === steps.length - 1 ? "Finish" : "Next", 'data-act="tour-next"')}${button("End tour", 'data-act="tour-end"', true)}</div></div>`;
}

function renderNav() {
  document.getElementById("nav").innerHTML = state.navigation
    .map(
      (group) =>
        `<small>${esc(group.label)}</small>${group.screens
          .map((screen) => `<button type="button" data-page="${esc(screen)}"${page === screen ? ' class="active" aria-current="page"' : ""}>${esc(screen)}</button>`)
          .join("")}`,
    )
    .join("");
}

function filterBar(statuses) {
  return `<form id="filter" class="row"><input aria-label="Search case or patient token" name="query" value="${esc(query)}" placeholder="Search ID or token">${select("status", ["All statuses", ...statuses], statusFilter || "All statuses")}<button class="btn alt">Filter</button>${button("Clear", 'data-act="clear"', true)}</form>`;
}

function matches(text, status) {
  return text.toLowerCase().includes(query.toLowerCase()) && (!statusFilter || statusFilter === "All statuses" || status === statusFilter);
}

function overview() {
  const completion = state.overview.completion;
  return `<div class="hero"><span class="tag">Outpatient care</span><h1>Care operations overview</h1><p>Screening, review, referral, and attendance figures come from the live workspace.</p><div class="row">${state.screens
    .filter((screen) => ["Intake", "Clinical review", "Follow-up"].includes(screen))
    .map((screen) => button(screen, `data-page="${esc(screen)}"`, true))
    .join("")}</div></div><div class="grid">${stat("Pending clinical review", state.overview.pendingReview, "Submitted screenings")}${stat("Open referrals", state.overview.openReferrals, "Awaiting a documented outcome")}${stat("Overdue follow-ups", state.overview.overdue, "Open referrals past due")}${stat("30-day completion", completion.rateLabel, `${completion.eligible} referrals with full observation`)}</div><div class="card"><h2>Care pathway</h2><div class="flow">${[
    ["Identify", "Intake and screening"],
    ["Review", "Clinical disposition"],
    ["Coordinate", "Eligibility and availability"],
    ["Verify", "Attendance and closure"],
    ["Plan", "Forecast and access gaps"],
  ]
    .map(([title, copy]) => `<div><b>${title}</b>${copy}</div>`)
    .join("")}</div></div>`;
}

function intake() {
  const current = selected && selected !== "new" ? recordById(selected) : null;
  if (selected) {
    const need = current?.need || "Depression";
    const instrument = state.instruments[need];
    return `${section(current?.id || "New intake", "Adult outpatient depression and anxiety")}<div class="card">${current?.reason ? `<p class="callout">${esc(current.reason)}</p>` : ""}<form id="intakeForm"><div class="grid">${field("Synthetic patient token", `<input name="token" required pattern="DEMO-[A-Za-z0-9-]+" value="${esc(current?.token || "")}" placeholder="DEMO-047">`)}${field("Encounter date", `<input name="encounter" type="date" required max="${esc(state.asOf)}" value="${esc(current?.encounter || state.asOf)}">`)}${field("Service area", select("area", ["Area A", "Area B"], current?.area || "Area A"))}${field("Screening focus", select("need", ["Depression", "Anxiety"], need))}${field("Payer", select("payer", ["Medicaid", "Commercial"], current?.payer || "Medicaid"))}${field("Preferred language", select("language", ["English", "Spanish"], current?.language || "English"))}${field("Screening score", `<input name="score" type="number" min="0" max="${instrument.max}" value="${esc(current?.score ?? "")}">`)}</div><p class="muted fine">Depression scores run through ${state.instruments.Depression.max}. Anxiety scores run through ${state.instruments.Anxiety.max}.</p><label><input name="urgent" type="checkbox" ${current?.urgent ? "checked" : ""}> Flag for urgent human review</label><label><input name="consent" type="checkbox" ${current?.consent ? "checked" : ""}> Patient agreement to share referral information recorded</label><div class="row"><button class="btn alt" name="intent" value="Draft">Save draft</button><button class="btn" name="intent" value="Submitted">Submit for review</button>${button("Back", 'data-page="Intake"', true)}</div></form></div>`;
  }
  const rows = state.records
    .filter((record) => matches(`${record.id} ${record.token}`, record.status))
    .map((record) => [esc(record.id), esc(record.token), esc(record.need), esc(record.encounter), tag(record.status, record.urgent), ["Draft", "Returned"].includes(record.status) ? button("Open", `data-open="${esc(record.id)}"`, true) : ""]);
  return `${section("Intake and screening", "Capture the encounter and prepare it for clinical review.")}<div class="card"><div class="row spread">${filterBar(["Draft", "Returned", "Submitted", "Approved", "Escalated"])}${button("New intake", 'data-open="new"')}</div>${table(["Case", "Patient token", "Focus", "Encounter", "Status", ""], rows)}</div>`;
}

function review() {
  const current = recordById(selected);
  const queued = state.reviewQueue.find((item) => item.id === selected);
  if (current && queued) {
    return `${section(`${current.id} · Clinical review`, "Review the screening, record an assessment, and document the disposition.")}<div class="grid">${stat("Screening score", current.score ?? "—", current.instrument)}${stat("BHRI", queued.bhri.status, queued.bhri.reason)}${stat("Sharing agreement", current.consent ? "Recorded" : "Missing", `${current.payer} · ${current.language}`)}</div><div class="card">${current.urgent ? `<p class="callout"><strong>Urgent safety flag.</strong> ${esc(queued.bhri.reason)}</p>` : ""}<form id="reviewForm">${field("Disposition", select("status", queued.dispositions))}${field("Assessment and rationale", `<textarea required maxlength="300" rows="3" name="reason" placeholder="Enter a synthetic assessment or reason for return."></textarea>`)}<div class="row"><button class="btn">Record decision</button>${current.urgent ? "" : button("Draft rationale", 'data-draft="rationale"', true)}${button("Back", 'data-page="Clinical review"', true)}</div></form></div>`;
  }
  const rows = state.reviewQueue.map((item) => {
    const record = recordById(item.id);
    return [esc(record.id), esc(record.need), esc(record.score ?? "—"), tag(item.priority, item.priority.startsWith("Urgent")), esc(record.encounter), button("Open", `data-open="${esc(record.id)}"`, true)];
  });
  return `${section("Clinical review", "Urgent flags first, followed by submitted cases in encounter order.")}<div class="card">${table(["Case", "Focus", "Score", "Review priority", "Encounter", ""], rows)}</div>`;
}

function referrals() {
  const current = recordById(selected);
  const match = state.matches.find((item) => item.caseId === selected);
  if (current && match) {
    const feasible = match.providers.filter((provider) => provider.eligible);
    const rows = match.providers.map((provider) => [
      esc(provider.name),
      esc(provider.capacity),
      `${esc(provider.wait)} days`,
      `${esc(provider.travel)} min`,
      esc(provider.payer),
      esc(provider.language),
      esc(provider.verified),
      tag(provider.eligible ? "Eligible" : "Check constraints", !provider.eligible),
    ]);
    const form = feasible.length
      ? `<form id="sendForm"><div class="grid">${field("Selected provider", `<select name="providerId">${feasible.map((provider) => `<option value="${esc(provider.id)}">${esc(provider.name)}</option>`).join("")}</select>`)}${field("Coordinator", select("owner", state.coordinators))}${field("Follow-up due", `<input type="date" name="due" required min="${esc(state.asOf)}" value="${esc(state.asOf)}">`)}</div><label><input type="checkbox" name="confirmed" required> Confirm patient choice and recheck availability</label><div class="row"><button class="btn">Record referral sent</button>${button("Draft match note", 'data-draft="match-note"', true)}</div></form>`
      : `<p class="callout">No eligible option. The case remains visible for coordinator review.</p><form id="barrierForm">${field("Assign coordinator", select("owner", state.coordinators))}${field("Barrier", select("barrier", state.barriers))}<button class="btn">Assign and record barrier</button></form>`;
    return `${section(`${current.id} · Referral matching`, "Eligibility, language, travel, and verified availability come from the server.")}<div class="card"><h2>Service options</h2>${table(["Provider", "Capacity / mo", "Wait", "Travel", "Payer", "Language", "Verified", "Match"], rows)}</div><div class="card">${form}${button("Back", 'data-page="Referrals"', true)}</div>`;
  }
  const ready = state.readyCaseIds.map((id) => {
    const record = recordById(id);
    return [esc(record.id), esc(record.area), esc(record.need), esc(record.barrier ? `${record.coordinator} · ${record.barrier}` : "Unassigned"), button("Open", `data-open="${esc(record.id)}"`, true)];
  });
  const register = state.referrals.map((referral) => [
    esc(referral.id),
    esc(referral.caseId),
    esc(referral.providerName),
    esc(referral.owner),
    esc(referral.due),
    tag(referral.overdue ? "Overdue" : referral.status, referral.overdue),
    state.screens.includes("Follow-up") ? button("View", `data-page="Follow-up" data-open="${esc(referral.id)}"`, true) : "",
  ]);
  return `${section("Referrals", "Match reviewed cases with eligible services and assign follow-up ownership.")}<div class="card"><h2>Ready for matching</h2>${table(["Case", "Service area", "Focus", "Owner / barrier", ""], ready)}</div><div class="card"><h2>Referral register</h2>${table(["Referral", "Case", "Provider", "Owner", "Due", "Status", ""], register)}</div>`;
}

function followup() {
  const current = referralById(selected);
  if (current) {
    const timeline = [`<li>${esc(current.sent)} · Sent</li>`, ...current.events.map((event) => `<li>${esc(event.when)} · <strong>${esc(event.type)}</strong> ${esc(event.note)}</li>`)].join("");
    const body =
      current.status === "Closed"
        ? `<div class="card"><h2>Closure outcome</h2><p>${esc(current.outcome)} · ${esc(current.closed)}</p><p>${esc(current.closureReason)}</p></div>`
        : `<div class="grid"><div class="card"><h2>Record an event</h2><form id="eventForm">${field("Event", select("type", current.availableEvents))}${field("Event date", `<input name="when" type="date" required min="${esc(current.sent)}" max="${esc(state.asOf)}" value="${esc(state.asOf)}">`)}${field("Source or note", `<input name="note" required maxlength="150" placeholder="Demo provider confirmation">`)}${field("Next follow-up", `<input name="due" type="date" required min="${esc(state.asOf)}" value="${esc(state.asOf)}">`)}<button class="btn">Add event</button></form></div><div class="card"><h2>Close referral</h2><form id="closeForm">${field("Outcome", select("outcome", current.closureOutcomes))}${field("Closure rationale", `<textarea required maxlength="300" name="reason"></textarea>`)}<button class="btn">Close referral</button></form></div></div>`;
    return `${section(`${current.id} · Follow-up`, `${current.providerName} · ${current.owner}`)}<div class="card"><div class="row spread"><h2>Referral timeline</h2>${tag(current.overdue ? "Overdue" : current.status, current.overdue)}</div><ol>${timeline}</ol></div>${body}${button("Back", 'data-page="Follow-up"', true)}`;
  }
  const rows = state.referrals
    .filter((referral) => matches(`${referral.id} ${referral.caseId} ${recordById(referral.caseId)?.token || ""}`, statusFilter === "Overdue" && referral.overdue ? "Overdue" : referral.status))
    .map((referral) => [esc(referral.id), esc(referral.caseId), esc(referral.providerName), esc(referral.owner), esc(referral.due), tag(referral.overdue ? "Overdue" : referral.status, referral.overdue), button("Open", `data-open="${esc(referral.id)}"`, true)]);
  return `${section("Follow-up", "Track acceptance, scheduling, attendance, and open follow-up tasks.")}<div class="card">${filterBar(["Sent", "Follow-up", "Closed", "Overdue"])}${table(["Referral", "Case", "Provider", "Owner", "Due", "Status", ""], rows)}</div>`;
}

function gaps() {
  const cards = state.gaps
    .map(
      (gap) =>
        `<div class="card"><div class="row spread"><h2>${esc(gap.area)}</h2>${tag(`${gap.gap} / 100`, gap.gap >= 35)}</div><div class="bar" role="meter" aria-label="Accessibility gap" aria-valuenow="${esc(gap.gap)}"><span style="width:${esc(gap.gap)}%"></span></div><p>${esc(gap.demand)} forecast slots needed<br>${esc(gap.slots)} verified slots allocated</p></div>`,
    )
    .join("");
  return `${section("Accessibility gaps", `BHAGI uses the first ${state.forecast.model} month as estimated need.`)}<div class="grid">${cards}</div><div class="card"><h2>Calculation</h2><p>BHAGI = 100 × max(0, 1 − verified accessible capacity ÷ forecast need). Stale verifications drop out of the capacity sum.</p>${state.screens.includes("Capacity scenarios") ? button("Capacity scenarios", 'data-page="Capacity scenarios"', true) : ""}</div>`;
}

function forecast() {
  const months = [...new Set(state.forecast.points.map((point) => point.month))];
  const cell = (area, month) => state.forecast.points.find((point) => point.area === area && point.month === month);
  const base = (area, month) => state.forecast.baseline.find((point) => point.area === area && point.month === month);
  const rows = months.map((month) => {
    const areaA = cell("Area A", month);
    const areaB = cell("Area B", month);
    return [esc(month), esc(areaA.point), `${esc(areaA.low)}–${esc(areaA.high)}`, esc(base("Area A", month).point), esc(areaB.point), `${esc(areaB.low)}–${esc(areaB.high)}`, esc(base("Area B", month).point)];
  });
  return `${section("Demand forecast", `${state.forecast.model} · point, interval, and seasonal naive baseline.`)}<div class="card"><h2>Projected service demand</h2>${table(["Month", "Area A", "Area A interval", "Area A baseline", "Area B", "Area B interval", "Area B baseline"], rows)}<p class="muted">The access-gap screen reads the first month in this table. The baseline is the seasonal comparison, not the need used for BHAGI.</p></div>`;
}

function scenarios() {
  const areas = state.gaps.map((gap) => gap.area);
  const area = areas.includes(scenarioInput.area) ? scenarioInput.area : areas[0];
  const result = scenario
    ? `<div class="grid">${stat("Baseline gap", `${scenario.baselineGap}%`, "Current verified capacity")}${stat("Scenario gap", `${scenario.scenarioGap}%`, "Added slots treated as accessible")}${stat("Unmet slots avoided", scenario.unmetSlotsAvoided, "Estimated monthly reduction")}${stat("Incremental cost", money(scenario.incrementalCost), scenario.withinBudget ? "Within monthly budget" : "Exceeds monthly budget")}</div>`
    : "";
  return `${section("Capacity scenarios", "Need and current slots are taken from the access-gap calculation.")}<div class="card"><form id="scenarioForm"><div class="grid">${field("Service area", select("area", areas, area))}${field("Additional monthly slots", `<input name="slots" type="number" min="0" max="10000" required value="${esc(scenarioInput.slots)}">`)}${field("Cost per slot (USD)", `<input name="unit" type="number" min="0" max="100000" step="0.01" required value="${esc(scenarioInput.unit)}">`)}${field("Monthly budget (USD)", `<input name="budget" type="number" min="0" max="10000000" step="0.01" required value="${esc(scenarioInput.budget)}">`)}</div><div class="row"><button class="btn">Compare scenario</button>${button("Draft note", 'data-draft="scenario-note"', true)}</div></form></div><div id="scenarioResult">${result}</div>`;
}

function outcomes() {
  const current = state.outcomes.find((item) => item.area === outcomeArea) || state.outcomes[0];
  const show = (value) => (value === null ? "Suppressed" : value);
  return `${section("Population outcomes", "Counts below the small-cell minimum are suppressed before they can be drafted.")}<div class="card"><form id="insightForm" class="row">${field("Service area", select("area", state.outcomes.map((item) => item.area), current.area))}<button class="btn alt">Apply</button></form></div><div class="grid">${stat("Referrals initiated", show(current.referrals), "Published count")}${stat("Verified 30-day completion", current.rateLabel, "Mature referrals")}${stat("Unknown outcomes", show(current.unknown), "Mature referrals without verified attendance")}${stat("Overdue follow-ups", show(current.overdue), "Open referrals past due")}</div><div class="card"><p class="muted">Operational counts on the overview stay visible to staff. This page is the population view.</p>${button("Draft outcomes note", 'data-draft="outcomes"', true)}</div>`;
}

function governance() {
  const providers = state.providers.map((provider) => [esc(provider.name), esc(provider.area), esc(provider.capacity), esc(provider.verified)]);
  const history = state.audit.map((entry) => [esc(String(entry.time).replace("T", " ").slice(0, 16)), esc(entry.role), esc(entry.id), esc(entry.event)]);
  return `${section("Governance and evaluation", "Capacity updates change the access gaps on the next view.")}<div class="card"><h2>Provider capacity registry</h2><form id="capacityForm"><div class="grid">${field("Provider", `<select name="providerId">${state.providers.map((provider) => `<option value="${esc(provider.id)}">${esc(provider.name)}</option>`).join("")}</select>`)}${field("Verified slots per month", `<input name="capacity" type="number" min="0" max="10000" required>`)}${field("Verification date", `<input name="verified" type="date" required max="${esc(state.asOf)}" value="${esc(state.asOf)}">`)}</div><button class="btn">Update registry</button></form><br>${table(["Provider", "Area", "Slots / mo", "Last verified"], providers)}</div><div class="card"><h2>Activity history</h2>${table(["Time", "Role", "Record", "Action"], history)}</div><div class="card"><h2>Prospective validation</h2><ol>${state.validationStages.map((stage) => `<li>${esc(stage)}</li>`).join("")}</ol><p class="muted">Current stage · synthetic workspace connected to the care functions.</p>${button("Reset demo data", 'data-act="reset"', true)}</div>`;
}

const views = {
  Overview: overview,
  Intake: intake,
  "Clinical review": review,
  Referrals: referrals,
  "Follow-up": followup,
  "Access gaps": gaps,
  "Demand forecast": forecast,
  "Capacity scenarios": scenarios,
  Outcomes: outcomes,
  Governance: governance,
};

function render() {
  fillRole();
  renderNav();
  app().innerHTML = `<p id="notice" role="status">${esc(message)}</p>${tourCard()}${views[page]()}`;
}

function gateShell(inner) {
  return `<div class="gate"><div class="gate-bar"><div class="brand"><span class="logo">BHI</span>BHI-CARE</div><div class="row">${button("Tour", 'data-gate="tour"', true)}${button("Sign in", 'data-gate="login"')}</div></div><div class="gate-main">${inner}</div></div>`;
}

function landingHtml() {
  const steps = [
    ["1", "Identify", "Intake records the screening and sharing agreement."],
    ["2", "Review", "A clinician records the disposition. The risk index abstains."],
    ["3", "Coordinate", "Referral matching checks eligibility and availability."],
    ["4", "Verify", "Follow-up tracks attendance through closure."],
    ["5", "Plan", "Forecast need drives the access gap and capacity scenarios."],
  ];
  return gateShell(`<div class="hero"><span class="tag">Synthetic workspace</span><h1>Behavioral health care operations</h1><p>Screen, review, refer, and plan outpatient capacity from one workspace. Figures on the signed-in screens come from the live functions.</p><div class="row">${button("Take the tour", 'data-gate="tour"', true)}${button("Sign in", 'data-gate="login"')}</div></div><div class="card"><h2>How a case moves</h2><div class="steps">${steps
    .map(([n, title, copy]) => `<div class="step"><b>${n}</b><div><strong>${title}</strong><p class="muted">${copy}</p></div></div>`)
    .join("")}</div></div><div class="grid"><div class="card"><h2>Draft notes</h2><p class="muted">Hugging Face writes a draft only from fields already on the screen. A person edits it before it is saved.</p></div><div class="card"><h2>Demand and gaps</h2><p class="muted">Monthly need is calculated in the app. Access gaps use that forecast and verified provider slots.</p></div></div>`);
}

function loginHtml() {
  const roles = access?.roles || [];
  return gateShell(`<div class="section-title"><h1>Sign in</h1><p class="muted">Open the synthetic workspace with a role. This is not a production account.</p></div><div class="card">${gateMessage ? `<p class="callout">${esc(gateMessage)}</p>` : ""}<form id="loginForm"><div class="grid">${field("Name on this workspace", `<input name="name" required minlength="2" maxlength="40" autocomplete="name" placeholder="Alex Morgan">`)}${field("Workspace role", `<select name="role">${roles.map((item) => `<option>${esc(item)}</option>`).join("")}</select>`)}${field("Access code", `<input name="accessCode" type="password" required autocomplete="current-password" placeholder="Access code">`)}</div><p class="muted fine">Synthetic access code: <strong>${esc(access?.demoAccessCode || "")}</strong></p><div class="row"><button class="btn">Open workspace</button>${button("Back", 'data-gate="landing"', true)}</div></form></div>`);
}

function publicTourHtml() {
  const step = PUBLIC_TOUR[publicStep];
  return gateShell(`<div class="card tour-card"><p class="muted">Tour ${publicStep + 1} of ${PUBLIC_TOUR.length}</p><h1>${esc(step[0])}</h1><p>${esc(step[1])}</p><div class="row">${publicStep > 0 ? button("Back", 'data-act="public-back"', true) : ""}${button(publicStep === PUBLIC_TOUR.length - 1 ? "Sign in" : "Next", publicStep === PUBLIC_TOUR.length - 1 ? 'data-gate="login"' : 'data-act="public-next"')}${button("Close", 'data-gate="landing"', true)}</div></div>`);
}

function showGate(view) {
  gateView = view;
  document.getElementById("workspace").hidden = true;
  const gate = document.getElementById("gate");
  gate.hidden = false;
  gate.innerHTML = view === "login" ? loginHtml() : view === "tour" ? publicTourHtml() : landingHtml();
}

async function openLogin() {
  gateMessage = "";
  if (!access) {
    const response = await fetch("/api/access");
    access = await response.json();
  }
  showGate("login");
}

function enterWorkspace(next) {
  session = next;
  role = next.role;
  sessionStorage.setItem("bhi-session", JSON.stringify(next));
  page = "Overview";
  selected = "";
  message = "";
  tourIndex = -1;
  document.getElementById("gate").hidden = true;
  document.getElementById("workspace").hidden = false;
  return refresh();
}

function signOut() {
  sessionStorage.removeItem("bhi-session");
  session = null;
  role = "";
  state = null;
  tourIndex = -1;
  message = "";
  showGate("landing");
}

function startWorkspaceTour() {
  const steps = workspaceSteps();
  if (!steps.length) return;
  tourIndex = 0;
  page = steps[0].screen;
  selected = "";
  message = "";
  render();
}

function moveTour(direction) {
  const steps = workspaceSteps();
  const next = tourIndex + direction;
  if (next < 0) return;
  if (next >= steps.length) {
    tourIndex = -1;
    render();
    return;
  }
  tourIndex = next;
  page = steps[next].screen;
  selected = "";
  render();
}

async function refresh() {
  state = await call("/api/state");
  if (!state.screens.includes(page)) page = state.screens[0];
  document.getElementById("gate").hidden = true;
  document.getElementById("workspace").hidden = false;
  render();
}

if (session) {
  document.getElementById("gate").hidden = true;
  document.getElementById("workspace").hidden = false;
  refresh().catch((error) => {
    app().innerHTML = `<p class="callout">${esc(error.message)}</p>`;
  });
} else {
  showGate("landing");
}

document.addEventListener("click", (event) => {
  const control = event.target.closest("button");
  if (!control) return;
  if (control.dataset.gate === "login") {
    openLogin().catch((error) => {
      gateMessage = error.message;
      showGate("login");
    });
    return;
  }
  if (control.dataset.gate === "tour") {
    publicStep = 0;
    showGate("tour");
    return;
  }
  if (control.dataset.gate === "landing") {
    showGate("landing");
    return;
  }
  if (control.dataset.act === "public-next") {
    publicStep = Math.min(PUBLIC_TOUR.length - 1, publicStep + 1);
    showGate("tour");
    return;
  }
  if (control.dataset.act === "public-back") {
    publicStep = Math.max(0, publicStep - 1);
    showGate("tour");
    return;
  }
  if (control.dataset.act === "sign-out") {
    signOut();
    return;
  }
  if (control.dataset.act === "start-tour") {
    startWorkspaceTour();
    return;
  }
  if (control.dataset.act === "tour-next") {
    moveTour(1);
    return;
  }
  if (control.dataset.act === "tour-back") {
    moveTour(-1);
    return;
  }
  if (control.dataset.act === "tour-end") {
    tourIndex = -1;
    render();
    return;
  }
  if (control.dataset.draft) {
    draft(control.dataset.draft).catch((error) => {
      message = error.message;
      render();
    });
    return;
  }
  if (control.dataset.page) {
    go(control.dataset.page, control.dataset.open || "");
    return;
  }
  if (control.dataset.open) {
    selected = control.dataset.open;
    message = "";
    render();
    return;
  }
  if (control.dataset.act === "clear") go(page);
  if (control.dataset.act === "reset" && page === "Governance" && confirm("Reset all changes to synthetic demo data?")) {
    call("/api/governance/reset", {})
      .then((result) => {
        message = result.message;
        selected = "";
        return refresh();
      })
      .catch((error) => {
        message = error.message;
        render();
      });
  }
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === "loginForm") {
    fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: data.name, role: data.role, accessCode: data.accessCode }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "Sign-in failed.");
        return enterWorkspace(body);
      })
      .catch((error) => {
        gateMessage = error.message;
        showGate("login");
      });
    return;
  }
  const done = (result, clearSelection = true) => {
    message = result.message;
    if (clearSelection) selected = "";
    return refresh();
  };
  const fail = (error) => {
    message = error.message;
    render();
  };
  if (form.id === "filter") {
    query = data.query.trim();
    statusFilter = data.status;
    render();
    return;
  }
  if (form.id === "insightForm") {
    outcomeArea = data.area;
    render();
    return;
  }
  if (form.id === "scenarioForm") {
    scenarioInput = { area: data.area, slots: data.slots, unit: data.unit, budget: data.budget };
    call("/api/planning/scenario", {
      area: data.area,
      additionalSlots: Number(data.slots),
      unitCost: Number(data.unit),
      budget: Number(data.budget),
    })
      .then((result) => {
        scenario = result;
        message = "";
        render();
      })
      .catch(fail);
    return;
  }
  if (form.id === "intakeForm") {
    call("/api/intake", {
        caseId: selected && selected !== "new" ? selected : undefined,
      token: data.token,
      encounter: data.encounter,
      area: data.area,
      need: data.need,
      payer: data.payer,
      language: data.language,
      score: data.score === "" ? null : Number(data.score),
      urgent: Boolean(data.urgent),
      consent: Boolean(data.consent),
      intent: event.submitter?.value || "Submitted",
    })
      .then((result) => done(result))
      .catch(fail);
    return;
  }
  if (form.id === "reviewForm") {
    call("/api/review", { caseId: selected, status: data.status, reason: data.reason }).then((result) => done(result)).catch(fail);
    return;
  }
  if (form.id === "barrierForm") {
    call("/api/referrals/barrier", { caseId: selected, owner: data.owner, barrier: data.barrier }).then((result) => done(result, false)).catch(fail);
    return;
  }
  if (form.id === "sendForm") {
    call("/api/referrals/send", { caseId: selected, providerId: data.providerId, owner: data.owner, due: data.due, confirmed: Boolean(data.confirmed) })
      .then((result) => {
        message = result.message;
        page = "Follow-up";
        selected = result.recordId;
        return refresh();
      })
      .catch(fail);
    return;
  }
  if (form.id === "eventForm") {
    call("/api/follow-up/event", { referralId: selected, type: data.type, when: data.when, note: data.note, due: data.due }).then((result) => done(result, false)).catch(fail);
    return;
  }
  if (form.id === "closeForm") {
    call("/api/follow-up/close", { referralId: selected, outcome: data.outcome, reason: data.reason }).then((result) => done(result, false)).catch(fail);
    return;
  }
  if (form.id === "capacityForm") {
    call("/api/governance/capacity", { providerId: data.providerId, capacity: Number(data.capacity), verified: data.verified }).then((result) => done(result, false)).catch(fail);
  }
});

async function draft(kind) {
  const record = recordById(selected);
  let facts = {};
  let urgent = false;
  if (kind === "rationale" && record) {
    urgent = Boolean(record.urgent);
    facts = { caseId: record.id, need: record.need, score: record.score, payer: record.payer, language: record.language, consent: record.consent };
  }
  if (kind === "match-note") {
    const match = state.matches.find((item) => item.caseId === selected);
    const provider = match?.providers.find((item) => item.eligible);
    facts = provider ? { caseId: selected, provider: provider.name, waitDays: provider.wait, travelMinutes: provider.travel, payer: provider.payer, language: provider.language } : { caseId: selected };
  }
  if (kind === "scenario-note") {
    if (!scenario) throw new Error("Compare a scenario before drafting a note.");
    facts = { ...scenario };
  }
  if (kind === "outcomes") {
    const current = state.outcomes.find((item) => item.area === outcomeArea) || state.outcomes[0];
    facts = Object.fromEntries(Object.entries(current).filter(([, value]) => value !== null));
  }
  const result = await call("/api/models/draft", { kind, urgent, facts });
  const reason = document.querySelector('textarea[name="reason"]');
  if (reason) reason.value = result.draft;
  message = "Draft inserted for review. Save it with the form.";
  const notice = document.getElementById("notice");
  if (notice) notice.textContent = message;
}
