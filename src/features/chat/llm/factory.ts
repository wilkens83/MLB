/* ============================================================================
   Provider factory. Selects the chat model provider from environment config.
   All providers run server-side only — API keys are never sent to the browser.

     CHAT_AI_PROVIDER = mock (default) | anthropic | openai | google
     CHAT_AI_MODEL    = provider-specific model id
     ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
   ========================================================================== */

import { createMockProvider } from "./mock-provider";
import { createAnthropicProvider } from "./anthropic-provider";
import type { ChatModelProvider } from "./types";

export class ProviderNotConfiguredError extends Error {
  constructor(readonly provider: string, reason: string) {
    super(`Chat provider "${provider}" is not usable: ${reason}`);
    this.name = "ProviderNotConfiguredError";
  }
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  google: "gemini-1.5-flash",
};

export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ChatModelProvider {
  const name = (env.CHAT_AI_PROVIDER ?? "mock").toLowerCase();
  const model = env.CHAT_AI_MODEL || DEFAULT_MODELS[name];

  switch (name) {
    case "mock":
      return createMockProvider();
    case "anthropic":
      // Real adapter; falls back to deterministic output when the key is absent.
      return createAnthropicProvider(model ?? DEFAULT_MODELS.anthropic);
    case "openai":
    case "google":
      // Interface-ready but no verified adapter shipped — fail loudly, never silently mock.
      throw new ProviderNotConfiguredError(
        name,
        "adapter not implemented in this build; set CHAT_AI_PROVIDER=anthropic or mock",
      );
    default:
      throw new ProviderNotConfiguredError(name, "unknown provider");
  }
}

/** True when the resolved provider is the offline deterministic mock. */
export function isMockProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CHAT_AI_PROVIDER ?? "mock").toLowerCase() === "mock";
}
