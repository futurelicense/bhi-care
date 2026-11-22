import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { can, isEligible, rankProviders } from "./domain/access.ts";
import { areaGaps, compareScenario } from "./domain/planning.ts";
import { PROTOTYPE_AREA_NEED, ROLES } from "./domain/types.ts";
import { seedWorkspace } from "./domain/seed.ts";
import { DEMO_ACCESS_CODE, openWorkspaceSession } from "./session.ts";
import {
  addFollowUpEvent,
  closeReferral,
  recordBarrier,
  recordDisposition,
  saveIntake,
  sendReferral,
  updateCapacity,
} from "./domain/workflow.ts";
import type { Clock, Role, Workspace } from "./domain/types.ts";
import { assessBhri } from "./models/bhri.ts";
import { modelConfig, type ModelConfig } from "./models/config.ts";
import { draftNote, type DraftInput } from "./models/draft.ts";
import { baselinePoints, FORECAST_MODEL_ID, forecastPoints, type ForecastSeries } from "./models/forecast.ts";
import { workspaceView } from "./view.ts";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "..", "public");

function loadEnvFile(): void {
  try {
    const text = readFileSync(join(root, "..", ".env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // A missing .env leaves the process environment unchanged.
  }
}

export interface ServerContext {
  workspace: Workspace;
  clock: Clock;
  config: ModelConfig;
  fetch: typeof fetch;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createContext(env: NodeJS.ProcessEnv = process.env): ServerContext {
  const asOf = today();
  return {
    workspace: seedWorkspace(asOf),
    clock: { asOf, now: new Date().toISOString() },
    config: modelConfig(env),
    fetch,
  };
}

function serveStatic(pathname: string): Response | null {
  if (pathname.startsWith("/api")) return null;
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (requested.includes("..")) return null;
  const full = join(publicDir, requested);
  if (!full.startsWith(publicDir) || !existsSync(full)) return null;
  const body = readFileSync(full);
  const type = requested.endsWith(".css")
    ? "text/css; charset=utf-8"
    : requested.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
  return new Response(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "no-store" } });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function roleOf(request: Request): Role | null {
  const role = request.headers.get("x-bhi-role");
  if (
    role === "Demo operator" ||
    role === "Intake staff" ||
    role === "Clinical reviewer" ||
    role === "Care coordinator" ||
    role === "Network planner" ||
    role === "Administrator"
  ) {
    return role;
  }
  return null;
}

function apply(ctx: ServerContext, result: { ok: true; workspace: Workspace; message: string; recordId: string } | { ok: false; message: string }): Response {
  if (!result.ok) {
    const status = result.message === "This role cannot change that record." ? 403 : 400;
    return json(status, result);
  }
  ctx.workspace = result.workspace;
  return json(200, { message: result.message, recordId: result.recordId });
}

export async function handleRequest(request: Request, ctx: ServerContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET") {
    const file = serveStatic(path);
    if (file) return file;
  }
  if (request.method === "GET" && path === "/api/health") {
    return json(200, {
      ok: true,
      forecastModel: FORECAST_MODEL_ID,
      draftModel: ctx.config.draftModel,
      bhri: ctx.config.bhriModel || "abstain",
    });
  }

  if (request.method === "GET" && path === "/api/state") {
    const active = roleOf(request) ?? "Demo operator";
    return json(200, workspaceView(ctx.workspace, active, ctx.clock.asOf));
  }

  if (request.method === "GET" && path === "/api/access") {
    return json(200, { roles: ROLES, demoAccessCode: DEMO_ACCESS_CODE });
  }

  if (request.method === "GET" && path === "/api/workspace") {
    return json(200, ctx.workspace);
  }

  const body = request.method === "POST" ? await readJson(request) : null;
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (request.method === "POST" && !record) return json(400, { message: "Expected a JSON body." });

  if (request.method === "POST" && path === "/api/session") {
    const result = openWorkspaceSession({
      name: String(record?.name ?? ""),
      role: String(record?.role ?? ""),
      accessCode: String(record?.accessCode ?? ""),
    });
    return json(result.ok ? 200 : 401, result);
  }

  if (request.method === "POST" && path === "/api/planning/gaps") {
    const needs = Array.isArray(record?.needs) ? (record.needs as { name: string; demand: number }[]) : PROTOTYPE_AREA_NEED;
    return json(200, { gaps: areaGaps(ctx.workspace.providers, needs, ctx.clock.asOf) });
  }

  if (request.method === "POST" && path === "/api/planning/scenario") {
    let need = Number(record?.need);
    let currentSlots = Number(record?.currentSlots);
    if (typeof record?.area === "string") {
      const gap = workspaceView(ctx.workspace, "Demo operator", ctx.clock.asOf).gaps.find((item) => item.area === record.area);
      if (!gap) return json(400, { message: "Service area was not found." });
      need = gap.demand;
      currentSlots = gap.slots;
    }
    try {
      return json(200, compareScenario({
        need,
        currentSlots,
        additionalSlots: Number(record?.additionalSlots),
        unitCost: Number(record?.unitCost),
        budget: Number(record?.budget),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid scenario.";
      return json(400, { message });
    }
  }

  if (request.method === "POST" && path === "/api/referrals/rank") {
    const screening = ctx.workspace.records.find((item) => item.id === record?.caseId);
    if (!screening) return json(404, { message: "Screening was not found." });
    const ranked = rankProviders(screening, ctx.workspace.providers, ctx.clock.asOf).map((provider) => ({
      id: provider.id,
      name: provider.name,
      eligible: isEligible(screening, provider, ctx.clock.asOf),
    }));
    return json(200, { ranked });
  }

  const role = roleOf(request);
  if (request.method === "POST" && path.startsWith("/api/") && !path.startsWith("/api/planning") && path !== "/api/referrals/rank") {
    if (!role) return json(403, { message: "This role cannot change that record." });
  }

  if (request.method === "POST" && path === "/api/intake") {
    return apply(
      ctx,
      saveIntake(
        ctx.workspace,
        typeof record?.caseId === "string" ? record.caseId : null,
        {
          token: String(record?.token ?? ""),
          encounter: String(record?.encounter ?? ""),
          area: record?.area as "Area A",
          need: record?.need as "Depression",
          payer: record?.payer as "Medicaid",
          language: record?.language as "English",
          score: record?.score === null || record?.score === undefined || record?.score === "" ? null : Number(record?.score),
          urgent: Boolean(record?.urgent),
          consent: Boolean(record?.consent),
          intent: record?.intent === "Draft" ? "Draft" : "Submitted",
        },
        role!,
        ctx.clock,
      ),
    );
  }
  if (request.method === "POST" && path === "/api/review") {
    return apply(ctx, recordDisposition(ctx.workspace, String(record?.caseId), record as never, role!, ctx.clock));
  }
  if (request.method === "POST" && path === "/api/referrals/barrier") {
    return apply(ctx, recordBarrier(ctx.workspace, String(record?.caseId), String(record?.owner), String(record?.barrier), role!, ctx.clock));
  }
  if (request.method === "POST" && path === "/api/referrals/send") {
    return apply(ctx, sendReferral(ctx.workspace, String(record?.caseId), record as never, role!, ctx.clock));
  }
  if (request.method === "POST" && path === "/api/follow-up/event") {
    return apply(ctx, addFollowUpEvent(ctx.workspace, String(record?.referralId), record as never, role!, ctx.clock));
  }
  if (request.method === "POST" && path === "/api/follow-up/close") {
    return apply(ctx, closeReferral(ctx.workspace, String(record?.referralId), record as never, role!, ctx.clock));
  }
  if (request.method === "POST" && path === "/api/governance/reset") {
    if (!role || !can(role, "Governance")) return json(403, { message: "This role cannot change that record." });
    ctx.workspace = seedWorkspace(ctx.clock.asOf);
    ctx.workspace.audit.unshift({ id: "Workspace", time: ctx.clock.now, role, event: "Demo data reset" });
    return json(200, { message: "Demo data reset", recordId: "Workspace" });
  }

  if (request.method === "POST" && path === "/api/governance/capacity") {
    return apply(ctx, updateCapacity(ctx.workspace, record as never, role!, ctx.clock));
  }

  if (request.method === "POST" && path === "/api/models/bhri") {
    if (!role || !can(role, "Clinical review")) return json(403, { message: "This role cannot change that record." });
    const screening = ctx.workspace.records.find((item) => item.id === record?.caseId);
    if (!screening) return json(404, { message: "Screening was not found." });
    return json(200, assessBhri(screening, ctx.config));
  }

  if (request.method === "POST" && path === "/api/models/draft") {
    const kind = record?.kind;
    const screen =
      kind === "rationale"
        ? "Clinical review"
        : kind === "match-note"
          ? "Referrals"
          : kind === "scenario-note"
            ? "Capacity scenarios"
            : kind === "outcomes"
              ? "Outcomes"
              : "";
    if (!role || !screen || !can(role, screen)) {
      return json(403, { message: "This role cannot change that record." });
    }
    const result = await draftNote(
      { kind: kind as DraftInput["kind"], urgent: Boolean(record?.urgent), facts: (record?.facts ?? {}) as DraftInput["facts"] },
      ctx.config,
      ctx.fetch,
    );
    return json(result.ok ? 200 : 400, result);
  }

  if (request.method === "POST" && path === "/api/models/baseline") {
    if (!role || !can(role, "Demand forecast")) return json(403, { message: "This role cannot change that record." });
    const series = (record?.series ?? []) as ForecastSeries[];
    const originMonth = String(record?.originMonth ?? "");
    const horizon = Number(record?.horizon ?? 4);
    return json(200, {
      label: "seasonal naive baseline",
      points: series.flatMap((item) => baselinePoints(item, originMonth, horizon)),
    });
  }

  if (request.method === "POST" && path === "/api/models/forecast") {
    if (!role || !can(role, "Demand forecast")) return json(403, { message: "This role cannot change that record." });
    const series = (record?.series ?? []) as ForecastSeries[];
    const originMonth = String(record?.originMonth ?? "");
    const horizon = Number(record?.horizon ?? 4);
    try {
      const points = series.flatMap((item) => forecastPoints(item, originMonth, horizon));
      return json(200, { model: FORECAST_MODEL_ID, points });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forecast failed.";
      return json(400, { error: message, model: FORECAST_MODEL_ID });
    }
  }

  return json(404, { message: "Not found." });
}

function toRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "localhost";
  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(body),
  });
}

export function startServer(ctx?: ServerContext): void {
  loadEnvFile();
  const context = ctx ?? createContext();
  const port = Number(process.env.PORT ?? 8787);
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void handleRequest(toRequest(req, Buffer.concat(chunks)), context).then(async (response) => {
        const payload = Buffer.from(await response.arrayBuffer());
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        res.writeHead(response.status, headers);
        res.end(payload);
      });
    });
  });
  server.listen(port, () => {
    console.log(`BHI-CARE listening on ${port}`);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) startServer();
