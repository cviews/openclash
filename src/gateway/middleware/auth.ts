import type { Context, Next } from "hono";
import { unauthorized } from "../../shared/errors.js";

/**
 * Per-provider Bearer token authentication middleware.
 */
export function authMiddleware(apiKey: string) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json(unauthorized().toJSON(), 401);
    }

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (token !== apiKey) {
      return c.json(unauthorized().toJSON(), 401);
    }

    await next();
  };
}
