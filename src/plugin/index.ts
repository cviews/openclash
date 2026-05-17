import type { PluginInput, Hooks } from "@opencode-ai/plugin";
import type { OpenClashPluginConfig } from "../config/types.js";
import { resolveConfig } from "../config/config.js";
import { createGateway, type Gateway } from "../gateway/index.js";
import { logger } from "../shared/logger.js";

const PLUGIN_VERSION = "0.1.0";

let activeGateway: Gateway | null = null;
let initializing = false;
let gatewayReadyPromise: Promise<void> | null = null;

/**
 * OpenCode plugin server function.
 * When loaded as a plugin, starts the gateway in the background
 * so that OpenAI-compatible provider configs can reach ACP agents.
 */
export async function openclashServerPlugin(
  input: PluginInput,
  options?: OpenClashPluginConfig,
): Promise<Hooks> {
  logger.silence();

  // Prevent double initialization
  if (activeGateway || initializing) {
    return {};
  }
  initializing = true;
  const config = resolveConfig(options);

  if (Object.keys(config.providers).length === 0) {
    return {};
  }

  const providerCount = Object.keys(config.providers).length;
  let toastShown = false;

  const showToast = () => {
    if (toastShown) return;
    toastShown = true;
    input.client.tui.showToast({
      body: {
        title: `OpenClash v${PLUGIN_VERSION}`,
        message: `ACP gateway ready. ${providerCount} provider(s) active.`,
        variant: "info",
        duration: 5000,
      },
    }).catch(() => {});
  };

  // Start gateway in background — don't block plugin initialization
  // Expose the promise so requests can await gateway readiness
  gatewayReadyPromise = createGateway(config).then(async (gateway) => {
    await gateway.start();
    activeGateway = gateway;
    showToast();
  });

  // Don't let startup errors crash the host
  gatewayReadyPromise.catch(() => {});

  // Shutdown gateway when host process exits
  const cleanup = () => {
    if (activeGateway) {
      activeGateway.stop().catch(() => {});
      activeGateway = null;
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return {
    event: async ({ event }) => {
      if (event.type === "session.created" && activeGateway) {
        showToast();
      }
    },
  };
}

/**
 * Wait for the gateway to be ready. Used internally if needed.
 */
export async function waitForGateway(): Promise<void> {
  if (gatewayReadyPromise) await gatewayReadyPromise;
}

export async function shutdownPlugin(): Promise<void> {
  if (activeGateway) {
    await activeGateway.stop();
    activeGateway = null;
  }
}
