import { Hono } from "hono";
import { createRequire } from "node:module";
import type { OpenClashConfig } from "../config/types.js";
import { providerPrefix } from "../config/types.js";
import type { ProtocolAdapter } from "../protocols/adapter.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { completionsHandler } from "./handlers/completions.js";
import { modelsHandler } from "./handlers/models.js";
import { logger } from "../shared/logger.js";

const TAG = "gateway";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../../package.json");

/**
 * Create the Hono app with all provider routes mounted.
 * Each provider has its own apiKey for per-route authentication.
 */
export function createGatewayApp(
  config: OpenClashConfig,
  adapters: Map<string, ProtocolAdapter>,
): Hono {
  const app = new Hono();

  app.onError(errorHandler);

  for (const [id, providerCfg] of Object.entries(config.providers)) {
    const adapter = adapters.get(id);
    if (!adapter) continue;

    const prefix = providerPrefix(id);
    logger.info(TAG, `Mounting provider "${id}" at ${prefix}/v1/*`);

    // Per-provider auth middleware — only when apiKey is configured
    if (providerCfg.apiKey) {
      app.use(`${prefix}/*`, authMiddleware(providerCfg.apiKey));
    }

    app.post(`${prefix}/v1/chat/completions`, completionsHandler(adapter));
    app.get(`${prefix}/v1/models`, modelsHandler(adapter, providerCfg));
  }

  // Health & info endpoints — no auth required
  app.get("/health", (c) => c.json({ status: "ok", providers: Object.keys(config.providers) }));

  app.get("/", (c) =>
    c.json({
      name: "openclash",
      version: PKG_VERSION,
      providers: Object.entries(config.providers).map(([id, cfg]) => ({
        id,
        name: cfg.name,
        baseURL: `http://${config.server.host}:${config.server.port}${providerPrefix(id)}/v1`,
        models: Object.keys(cfg.models),
      })),
    }),
  );

  return app;
}
