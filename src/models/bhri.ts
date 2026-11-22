import type { ScreeningCase } from "../domain/types.ts";
import type { ModelConfig } from "./config.ts";

export interface BhriResult {
  status: "abstain";
  model: string | null;
  reason: string;
}

export function assessBhri(record: Pick<ScreeningCase, "urgent" | "score">, config: ModelConfig): BhriResult {
  if (record.urgent) {
    return {
      status: "abstain",
      model: null,
      reason: "Urgent safety flag. Route to the clinician. Routine model ranking is bypassed.",
    };
  }
  if (record.score === null) {
    return {
      status: "abstain",
      model: null,
      reason: "Screening score is missing.",
    };
  }
  if (config.bhriModel) {
    return {
      status: "abstain",
      model: config.bhriModel,
      reason: "A private BHRI model id is configured. Scoring stays off until that model is validated.",
    };
  }
  return {
    status: "abstain",
    model: null,
    reason: "No BHRI model is configured.",
  };
}
