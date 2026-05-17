import type { PluginModule } from "@opencode-ai/plugin";
import { openclashServerPlugin } from "./plugin/index.js";

export { resolveConfig } from "./config/index.js";
export { createGateway } from "./gateway/index.js";
export { openclashServerPlugin } from "./plugin/index.js";
export type { OpenClashConfig, OpenClashPluginConfig, ProviderConfig, ModelConfig } from "./config/types.js";

const pluginModule: PluginModule = {
  id: "openclash",
  server: openclashServerPlugin,
};

export default pluginModule;
