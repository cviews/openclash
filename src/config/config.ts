import type {
  OpenClashConfig,
  OpenClashPluginConfig,
} from "./types.js";
import { loadConfigFile } from "./loader.js";

const DEFAULT_PORT = 8080;
const DEFAULT_HOST = "0.0.0.0";

export function resolveConfig(
  overrides?: OpenClashPluginConfig,
  configPath?: string,
): OpenClashConfig {
  const fileConfig = loadConfigFile(configPath) as OpenClashPluginConfig;

  const merged: OpenClashPluginConfig = {
    ...fileConfig,
    ...overrides,
    server: { ...fileConfig.server, ...overrides?.server },
    providers: { ...fileConfig.providers, ...overrides?.providers },
  };

  return {
    server: {
      port: envInt("OPENCLASH_PORT") ?? merged.server?.port ?? DEFAULT_PORT,
      host: process.env["OPENCLASH_HOST"] ?? merged.server?.host ?? DEFAULT_HOST,
    },
    providers: merged.providers ?? {},
  };
}

function envInt(key: string): number | undefined {
  const val = process.env[key];
  if (val === undefined) return undefined;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
