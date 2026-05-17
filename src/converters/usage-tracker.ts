import type { TokenUsage } from "../shared/types.js";

/**
 * Tracks token usage across an ACP request.
 *
 * ACP has two usage signals:
 * 1. `PromptResponse.usage` — { inputTokens, outputTokens, totalTokens }
 *    Authoritative when present, but some agents don't return it.
 * 2. `usage_update` notification — { used, size, cost }
 *    This is context window fill, not token count. Not directly usable.
 *
 * Fallback strategy when PromptResponse.usage is missing:
 *   - Estimate prompt_tokens from message content length (~4 chars/token)
 *   - Count completion_tokens from streamed text length (~4 chars/token)
 *   - Always return a usage object so OpenAI clients don't break
 */

const CHARS_PER_TOKEN_ESTIMATE = 4;

export class UsageTracker {
  private promptChars = 0;
  private completionChars = 0;
  private acpUsage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null = null;

  /** Call once with the total input message text length */
  setPromptLength(chars: number): void {
    this.promptChars = chars;
  }

  /** Call for each agent_message_chunk text */
  addCompletionChars(chars: number): void {
    this.completionChars += chars;
  }

  /** Call when PromptResponse resolves with usage */
  setAcpUsage(usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): void {
    if (usage) this.acpUsage = usage;
  }

  /** Resolve final usage. Prefers ACP authoritative data, falls back to estimate. */
  resolve(): TokenUsage {
    if (this.acpUsage) {
      const input = this.acpUsage.inputTokens ?? 0;
      const output = this.acpUsage.outputTokens ?? 0;
      const total = this.acpUsage.totalTokens ?? (input + output);
      if (input > 0 || output > 0 || total > 0) {
        return { prompt_tokens: input, completion_tokens: output, total_tokens: total };
      }
    }

    // Fallback: estimate from char counts
    const promptTokens = Math.ceil(this.promptChars / CHARS_PER_TOKEN_ESTIMATE);
    const completionTokens = Math.ceil(this.completionChars / CHARS_PER_TOKEN_ESTIMATE);
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    };
  }
}
