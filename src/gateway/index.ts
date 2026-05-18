import { serve } from "@hono/node-server";
import type { OpenClashConfig } from "../config/types.js";
import { providerPrefix } from "../config/types.js";
import type { ProtocolAdapter } from "../protocols/adapter.js";
import { createAdapter } from "../protocols/index.js";
import { createGatewayApp } from "./server.js";
import { logger } from "../shared/logger.js";
import { isPortAvailable, isOpenClashRunning } from "../shared/port.js";

const TAG = "gateway";

export type Gateway = {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The actual port the gateway is listening on */
  port: number;
  /** Whether this instance owns the server or is attached to an existing one */
  isOwner: boolean;
};

export async function createGateway(config: OpenClashConfig): Promise<Gateway> {
  const { port, host } = config.server;

  // Check if the port is already occupied by another OpenClash instance
  const portFree = await isPortAvailable(port, host);
  if (!portFree) {
    const alreadyRunning = await isOpenClashRunning(port, host, { retries: 3, delay: 500 });
    if (alreadyRunning) {
      logger.info(TAG, `OpenClash gateway already running on port ${port}, attaching to existing instance`);
      return {
        get port() { return port; },
        get isOwner() { return false; },
        async start() {},
        async stop() {},
      };
    }
    // Port is occupied by something else — let it fail with a clear message
    throw new Error(`Port ${port} is already in use by another process (not OpenClash)`);
  }

  // We own this server — proceed with full startup
  const adapters = new Map<string, ProtocolAdapter>();
  for (const [id, providerCfg] of Object.entries(config.providers)) {
    adapters.set(id, createAdapter(id, providerCfg));
  }

  const app = createGatewayApp(config, adapters);
  let server: ReturnType<typeof serve> | null = null;

  return {
    get port() { return port; },
    get isOwner() { return true; },

    async start() {
      server = serve({
        fetch: app.fetch,
        port,
        hostname: host,
      });

      logger.info(TAG, `OpenClash gateway listening on http://${host}:${port}`);

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
      for (const [id, providerCfg] of Object.entries(config.providers)) {
        const prefix = providerPrefix(id);
        const baseURL = `http://${host}:${port}${prefix}/v1`;
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
