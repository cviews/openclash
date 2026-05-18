import type { PluginInput, Hooks } from "@opencode-ai/plugin";
import type { OpenClashPluginConfig } from "../config/types.js";
import { resolveConfig } from "../config/config.js";
import { createGateway, type Gateway } from "../gateway/index.js";
import { isOpenClashRunning } from "../shared/port.js";
import { logger } from "../shared/logger.js";

const PLUGIN_VERSION = "0.1.0";

let activeGateway: Gateway | null = null;
let initializing = false;
let gatewayReadyPromise: Promise<void> | null = null;
let pluginConfig: ReturnType<typeof resolveConfig> | null = null;

/**
 * OpenCode plugin server function.
 * When loaded as a plugin, starts the gateway in the background
 * so that OpenAI-compatible provider configs can reach ACP agents.
 *
 * If another OpenClash instance is already running on the configured port,
 * this plugin attaches to it. If the existing gateway goes down, this instance
 * automatically promotes itself to owner and starts a new server.
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
  pluginConfig = config;

  if (Object.keys(config.providers).length === 0) {
    return {};
  }

  const providerCount = Object.keys(config.providers).length;
  let toastShown = false;

  const showToast = (port: number, attached: boolean) => {
    if (toastShown) return;
    toastShown = true;
    const mode = attached ? "Attached to existing gateway." : "Gateway started.";
    input.client.tui.showToast({
      body: {
        title: `OpenClash v${PLUGIN_VERSION}`,
        message: `${mode} ${providerCount} provider(s) on port ${port}.`,
        variant: "info",
        duration: 5000,
      },
    }).catch(() => {});
  };

  /**
   * Ensure a gateway is available — either start one or attach to an existing one.
   * If we were attached and the remote gateway died, promote to owner.
   */
  const ensureGateway = async (): Promise<void> => {
    // If we already own a running server, nothing to do
    if (activeGateway?.isOwner) return;

    // If we were attached, check if the remote gateway is still alive
    if (activeGateway && !activeGateway.isOwner) {
      const stillAlive = await isOpenClashRunning(config.server.port, config.server.host);
      if (stillAlive) return;
      // Remote gateway is gone — promote ourselves
      activeGateway = null;
    }

    // Start or attach
    const gateway = await createGateway(config);
    await gateway.start();
    activeGateway = gateway;
    toastShown = false;
    showToast(gateway.port, !gateway.isOwner);
  };

  // Initial start
  gatewayReadyPromise = ensureGateway();

  // Don't let startup errors crash the host
  gatewayReadyPromise.catch(() => {});

  // Shutdown gateway when host process exits (only if we own the server)
  const cleanup = () => {
    if (activeGateway?.isOwner) {
      activeGateway.stop().catch(() => {});
      activeGateway = null;
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        // On each new session, ensure gateway is still available
        // (handles the case where the owner TUI was closed)
        try {
          await ensureGateway();
        } catch {
          // Best effort — don't crash the host
        }
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
  if (activeGateway?.isOwner) {
    await activeGateway.stop();
    activeGateway = null;
  }
}
