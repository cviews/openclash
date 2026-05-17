import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ProtocolAdapter } from "../../protocols/adapter.js";
import type { ChatCompletionRequest } from "../../shared/types.js";
import { badRequest, OpenAIError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

const TAG = "completions";

/**
 * POST /{prefix}/v1/chat/completions - Chat completion endpoint.
 * Supports both streaming (SSE) and non-streaming responses.
 */
export function completionsHandler(adapter: ProtocolAdapter) {
  return async (c: Context) => {
    let body: ChatCompletionRequest;
    try {
      body = await c.req.json<ChatCompletionRequest>();
    } catch {
      const err = badRequest("Invalid JSON body");
      return c.json(err.toJSON(), err.status as 400);
    }

    if (!body.model) {
      const err = badRequest("'model' is required");
      return c.json(err.toJSON(), err.status as 400);
    }

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      const err = badRequest("'messages' must be a non-empty array");
      return c.json(err.toJSON(), err.status as 400);
    }

    logger.info(TAG, `${body.stream !== false ? "stream" : "complete"} model=${body.model} messages=${body.messages.length}`);
    logger.debug(TAG, `Full request body: ${JSON.stringify(body, null, 2)}`);

    try {
      if (body.stream !== false) {
        return streamSSE(c, async (stream) => {
          const generator = adapter.stream(body, c.req.raw.signal);
          for await (const chunk of generator) {
            await stream.writeSSE({
              data: JSON.stringify(chunk),
            });
          }
          await stream.writeSSE({ data: "[DONE]" });
        });
      } else {
        const response = await adapter.complete(body);
        return c.json(response);
      }
    } catch (err) {
      if (err instanceof OpenAIError) {
        return c.json(err.toJSON(), err.status as any);
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      logger.error(TAG, `Request failed: ${errMsg}`);
      if (errStack) logger.debug(TAG, errStack);
      return c.json(
        { error: { message: errMsg || "Internal error", type: "server_error", code: null } },
        500,
      );
    }
  };
}
