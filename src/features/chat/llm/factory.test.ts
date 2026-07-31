import { test, expect, describe } from "bun:test";
import { resolveProvider, isMockProvider, ProviderNotConfiguredError } from "./factory";

describe("provider factory", () => {
  test("defaults to the mock provider", () => {
    const p = resolveProvider({} as NodeJS.ProcessEnv);
    expect(p.name).toBe("mock");
    expect(p.developmentMode).toBe(true);
    expect(isMockProvider({} as NodeJS.ProcessEnv)).toBe(true);
  });

  test("resolves anthropic when requested (adapter present)", () => {
    const p = resolveProvider({ CHAT_AI_PROVIDER: "anthropic", CHAT_AI_MODEL: "claude-x" } as NodeJS.ProcessEnv);
    expect(p.name).toBe("anthropic");
    expect(p.model).toBe("claude-x");
  });

  test("throws for providers without a shipped adapter", () => {
    expect(() => resolveProvider({ CHAT_AI_PROVIDER: "openai" } as NodeJS.ProcessEnv)).toThrow(ProviderNotConfiguredError);
    expect(() => resolveProvider({ CHAT_AI_PROVIDER: "google" } as NodeJS.ProcessEnv)).toThrow(ProviderNotConfiguredError);
  });

  test("throws for an unknown provider", () => {
    expect(() => resolveProvider({ CHAT_AI_PROVIDER: "acme" } as NodeJS.ProcessEnv)).toThrow(ProviderNotConfiguredError);
  });
});
