export interface ModelConfig {
  token: string;
  draftModel: string;
  bhriModel: string;
  routerUrl: string;
}

export function modelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  return {
    token: env.HF_TOKEN?.trim() ?? "",
    draftModel: env.HF_MODEL_DRAFT?.trim() || "Qwen/Qwen2.5-7B-Instruct",
    bhriModel: env.HF_MODEL_BHRI?.trim() ?? "",
    routerUrl: env.HF_ROUTER_URL?.trim() || "https://router.huggingface.co/v1/chat/completions",
  };
}
