import { publishableCount } from "../domain/planning.ts";
import { SMALL_CELL_MINIMUM } from "../domain/types.ts";
import type { ModelConfig } from "./config.ts";

export type DraftKind = "rationale" | "match-note" | "scenario-note" | "outcomes";

export interface DraftInput {
  kind: DraftKind;
  urgent?: boolean;
  facts: Record<string, string | number | boolean | null>;
}

export type DraftResult =
  | { ok: true; draft: string; model: string }
  | { ok: false; error: string; skipped?: boolean };

const SYSTEM = [
  "You draft a short note for a behavioral health staff member.",
  "Use only the JSON facts in the user message.",
  "Do not add a diagnosis, a treatment, a risk score, or any number that is not in the facts.",
  "Reply with JSON of the form {\"draft\":\"...\"} and nothing else.",
  "Keep the draft under 300 characters.",
].join(" ");

export function draftRequest(input: DraftInput, config: ModelConfig): { url: string; init: RequestInit } | DraftResult {
  if (input.urgent || input.facts.urgent === true) {
    return { ok: false, skipped: true, error: "Urgent cases are not sent to the draft model." };
  }
  if (input.kind === "outcomes") {
    const suppressed = Object.entries(input.facts).filter(([, value]) => typeof value === "number" && publishableCount(value) === null);
    if (suppressed.length) {
      return {
        ok: false,
        error: `Counts below ${SMALL_CELL_MINIMUM} are suppressed and cannot be sent to the draft model.`,
      };
    }
  }
  if (!config.token) return { ok: false, error: "HF_TOKEN is not configured." };
  return {
    url: config.routerUrl,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.draftModel,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify({ kind: input.kind, facts: input.facts }) },
        ],
      }),
    },
  };
}

export async function draftNote(
  input: DraftInput,
  config: ModelConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DraftResult> {
  const request = draftRequest(input, config);
  if ("ok" in request) return request;
  const response = await fetchImpl(request.url, request.init);
  if (!response.ok) return { ok: false, error: `Draft model returned ${response.status}.` };
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: "Draft model did not return JSON." };
  let parsed: { draft?: unknown };
  try {
    parsed = JSON.parse(match[0]) as { draft?: unknown };
  } catch {
    return { ok: false, error: "Draft model did not return JSON." };
  }
  if (typeof parsed.draft !== "string" || !parsed.draft.trim()) {
    return { ok: false, error: "Draft model did not return a draft." };
  }
  return { ok: true, draft: parsed.draft.trim().slice(0, 300), model: config.draftModel };
}
