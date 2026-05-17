import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from "../shared/types.js";

/**
 * Protocol adapter interface. Each backend protocol (ACP, HTTP proxy, etc.)
 * implements this to provide a unified interface for the gateway.
 */
export interface ProtocolAdapter {
  /** Unique adapter identifier */
  readonly id: string;

  /** Initialize the backend connection (spawn subprocess, etc.) */
  initialize(): Promise<void>;

  /** Non-streaming completion: returns a full response */
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /** Streaming completion: yields SSE chunks as they arrive */
  stream(request: ChatCompletionRequest, signal: AbortSignal): AsyncGenerator<ChatCompletionChunk>;

  /** List models this adapter supports */
  listModels(): Array<{ id: string; name: string }>;

  /** Graceful shutdown */
  shutdown(): Promise<void>;
}
