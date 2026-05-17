// OpenAI Chat Completion request/response types

export type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatCompletionRequest = {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  /** Extra options pass-through (e.g. thinking config from opencode) */
  options?: Record<string, unknown>;
};

export type ChatCompletionChoice = {
  index: number;
  message: { role: "assistant"; content: string | null };
  finish_reason: FinishReason | null;
};

export type ChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: TokenUsage;
};

export type ChatCompletionChunkDelta = {
  role?: "assistant";
  content?: string;
};

export type ChatCompletionChunkChoice = {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: FinishReason | null;
};

export type ChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: TokenUsage | null;
};

export type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type FinishReason = "stop" | "length" | "tool_calls";

export type ModelObject = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

export type ModelListResponse = {
  object: "list";
  data: ModelObject[];
};
