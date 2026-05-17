import { serve } from "@hono/node-server";
import type { OpenClashConfig } from "../config/types.js";
import { providerPrefix } from "../config/types.js";
import type { ProtocolAdapter } from "../protocols/adapter.js";
import { createAdapter } from "../protocols/index.js";
import { createGatewayApp } from "./server.js";
import { logger } from "../shared/logger.js";

const TAG = "gateway";

export type Gateway = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export async function createGateway(config: OpenClashConfig): Promise<Gateway> {
  const adapters = new Map<string, ProtocolAdapter>();

  for (const [id, providerCfg] of Object.entries(config.providers)) {
    adapters.set(id, createAdapter(id, providerCfg));
  }

  const app = createGatewayApp(config, adapters);
  let server: ReturnType<typeof serve> | null = null;

  return {
    async start() {
      // Start HTTP server first so the port is available immediately
      server = serve({
        fetch: app.fetch,
        port: config.server.port,
        hostname: config.server.host,
      });

      logger.info(TAG, `OpenClash gateway listening on http://${config.server.host}:${config.server.port}`);

      // Initialize providers in background — requests will wait via ensureConnected()
      logger.info(TAG, `Initializing ${adapters.size} provider(s)...`);
      await Promise.all(
        Array.from(adapters.entries()).map(async ([id, adapter]) => {
          logger.info(TAG, `Initializing provider "${id}"...`);
          try {
            await adapter.initialize();
            logger.info(TAG, `Provider "${id}" ready`);
          } catch (err) {
            logger.error(TAG, `Provider "${id}" failed to initialize`, err);
          }
        }),
      );

      logger.info(TAG, "");
      // Print per-provider connection info
      for (const [id, providerCfg] of Object.entries(config.providers)) {
        const prefix = providerPrefix(id);
        const baseURL = `http://${config.server.host}:${config.server.port}${prefix}/v1`;
        const models = Object.keys(providerCfg.models).join(", ");
        const auth = providerCfg.apiKey ? "enabled" : "disabled";
        logger.info(TAG, `  ${providerCfg.name}:`);
        logger.info(TAG, `    baseURL: ${baseURL}`);
        logger.info(TAG, `    auth:    ${auth}`);
        logger.info(TAG, `    models:  [${models}]`);
        logger.info(TAG, "");
      }
    },

    async stop() {
      if (server) {
        server.close();
        server = null;
      }
      await Promise.all(
        Array.from(adapters.values()).map((adapter) => adapter.shutdown()),
      );
      logger.info(TAG, "Gateway stopped");
    },
  };
}
