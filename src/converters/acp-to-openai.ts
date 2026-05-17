import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  TokenUsage,
  FinishReason,
} from "../shared/types.js";

/**
 * ACP session update shape (subset we care about for conversion).
 * The full type comes from @agentclientprotocol/sdk SessionNotification.
 */
export type AcpSessionUpdate = {
  sessionId: string;
  update: AcpUpdateVariant;
};

export type AcpUpdateVariant =
  | { sessionUpdate: "agent_message_chunk"; messageId: string; content: { type: "text"; text: string } }
  | { sessionUpdate: "agent_thought_chunk"; messageId: string; content: { type: "text"; text: string } }
  | { sessionUpdate: "user_message_chunk"; messageId: string; content: { type: string } }
  | { sessionUpdate: "tool_call"; toolCallId: string; title: string }
  | { sessionUpdate: "tool_call_update"; toolCallId: string; status: string }
  | { sessionUpdate: "usage_update"; used: number; size: number; cost?: { amount: number; currency: string } }
  | { sessionUpdate: "plan"; entries: unknown[] }
  | { sessionUpdate: "available_commands_update" }
  | { sessionUpdate: "config_option_update" }
  | { sessionUpdate: string };

/**
 * Convert an ACP session update notification into an OpenAI SSE chunk.
 * Returns null for updates that don't map to OpenAI output.
 */
export function sessionUpdateToChunk(
  update: AcpUpdateVariant,
  requestId: string,
  model: string,
  created: number,
): ChatCompletionChunk | null {
  if (update.sessionUpdate === "agent_message_chunk") {
    const u = update as { sessionUpdate: "agent_message_chunk"; content: { type: "text"; text: string } };
    if (u.content.type === "text" && u.content.text) {
      return {
        id: requestId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content: u.content.text }, finish_reason: null }],
      };
    }
  }
  return null;
}

/** Initial SSE chunk with assistant role marker. */
export function createRoleChunk(requestId: string, model: string, created: number): ChatCompletionChunk {
  return {
    id: requestId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
}

/** Final SSE chunk with finish reason and optional usage. */
export function createFinishChunk(
  requestId: string,
  model: string,
  created: number,
  finishReason: FinishReason,
  usage?: TokenUsage,
): ChatCompletionChunk {
  return {
    id: requestId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    usage: usage ?? null,
  };
}

/** Map ACP stop reason to OpenAI finish_reason. */
export function convertStopReason(reason: string | undefined): FinishReason {
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "tool_calls";
  return "stop";
}

/**
 * Convert ACP PromptResponse.usage to OpenAI TokenUsage.
 * ACP provides: inputTokens, outputTokens, totalTokens, thoughtTokens, cachedReadTokens, cachedWriteTokens
 * OpenAI expects: prompt_tokens, completion_tokens, total_tokens
 */
export function convertUsage(acpUsage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thoughtTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}): TokenUsage | undefined {
  if (!acpUsage) return undefined;

  const promptTokens = acpUsage.inputTokens ?? 0;
  const completionTokens = acpUsage.outputTokens ?? 0;
  const totalTokens = acpUsage.totalTokens ?? (promptTokens + completionTokens);

  // If both are 0 and total is 0, ACP didn't report usage at all
  if (totalTokens === 0 && promptTokens === 0 && completionTokens === 0) return undefined;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

/** Assemble collected text chunks into a full non-streaming ChatCompletionResponse. */
export function assembleResponse(
  requestId: string,
  model: string,
  created: number,
  content: string,
  finishReason: FinishReason,
  usage?: TokenUsage,
): ChatCompletionResponse {
  return {
    id: requestId,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: content || null },
        finish_reason: finishReason,
      },
    ],
    usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
