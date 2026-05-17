import type { Context } from "hono";
import { OpenAIError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

const TAG = "error-handler";

/**
 * Global error handler that returns OpenAI-compatible error responses.
 */
export function errorHandler(err: Error, c: Context) {
  if (err instanceof OpenAIError) {
    return c.json(err.toJSON(), err.status as any);
  }

  logger.error(TAG, "Unhandled error", err);
  return c.json(
    {
      error: {
        message: err.message || "Internal server error",
        type: "server_error",
        code: null,
      },
    },
    500,
  );
}
