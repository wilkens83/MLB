/* ============================================================================
   Anthropic provider (CHAT_AI_PROVIDER=anthropic). Real, server-side, env-gated.

   Safety-first hybrid: the controlled tools + deterministic builders produce ALL
   numbers, blocks, and sources from real data; the model only rewrites the
   user-facing `answer` prose and follow-up suggestions. This means even with a
   live LLM the assistant cannot fabricate a stat — the numbers never originate
   from the model. Any API failure falls back to the deterministic answer.

   NOTE: requires ANTHROPIC_API_KEY. Not exercised in environments without a key;
   the mock provider is the verified default.
   ========================================================================== */

import { runDeterministic } from "./mock-provider";
import { buildSystemPrompt } from "../prompts/system-prompt";
import type { ChatModelProvider, ProviderInput, ProviderResult } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";

interface AnthropicTextResponse {
  content?: { type: string; text?: string }[];
}

async function polishAnswer(
  apiKey: string,
  model: string,
  input: ProviderInput,
  draftAnswer: string,
  dataSummary: string,
  signal?: AbortSignal,
): Promise<{ answer: string; suggested?: string[] } | null> {
  const system =
    buildSystemPrompt({
      date: input.context.date,
      season: input.context.season,
      timezone: input.context.timezone,
      sport: input.context.sport,
    }) +
    "\n\nYou are given TOOL DATA (already computed) and a DRAFT answer. Rewrite ONLY the prose answer to be clear and concise. Do NOT introduce any number, name, or claim not present in the tool data. Reply as JSON: {\"answer\": string, \"suggestedQuestions\": string[]}.";

  const res = await fetch(API_URL, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system,
      messages: [
        {
          role: "user",
          content: `USER QUESTION:\n${input.message}\n\nTOOL DATA (authoritative — do not add to it):\n${dataSummary}\n\nDRAFT ANSWER:\n${draftAnswer}`,
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as AnthropicTextResponse;
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    const parsed = JSON.parse(text) as { answer?: string; suggestedQuestions?: string[] };
    if (typeof parsed.answer === "string" && parsed.answer.trim())
      return { answer: parsed.answer.trim(), suggested: parsed.suggestedQuestions };
  } catch {
    /* fall through to null */
  }
  return null;
}

export function createAnthropicProvider(model: string): ChatModelProvider {
  return {
    name: "anthropic",
    model,
    developmentMode: false,
    async respond(input: ProviderInput): Promise<ProviderResult> {
      // Always compute real data + blocks deterministically first.
      const { response, state, composed } = await runDeterministic(input, {
        provider: "anthropic",
        model,
        developmentMode: false,
      });

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return { response, state };

      const dataSummary = JSON.stringify({
        answer: composed.answer,
        blocks: composed.blocks.map((b) => ({ type: b.type, ...("title" in b ? { title: b.title } : {}) })),
        warnings: composed.warnings,
      }).slice(0, 4000);

      const polished = await polishAnswer(
        apiKey,
        model,
        input,
        composed.answer,
        dataSummary,
        input.context.signal,
      ).catch(() => null);

      if (polished) {
        response.answer = polished.answer;
        if (polished.suggested?.length) response.suggestedQuestions = polished.suggested.slice(0, 6);
      }
      return { response, state };
    },
  };
}
