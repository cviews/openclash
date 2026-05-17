import * as crypto from "node:crypto";

export type ServerConfig = {
  port: number;
  host: string;
};

export type ModelLimit = {
  context: number;
  output: number;
};

export type ModelConfig = {
  id: string;
  name: string;
  limit?: ModelLimit;
};

export type AcpProviderOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/**
 * Provider config — mirrors opencode's ACP provider format.
 * Each provider gets its own apiKey for authentication.
 * If not configured, one is auto-generated at startup.
 */
export type ProviderConfig = {
  name: string;
  type: "acp";
  apiKey?: string;
  options: AcpProviderOptions;
  models: Record<string, ModelConfig>;
};

export type OpenClashPluginConfig = {
  server?: Partial<ServerConfig>;
  providers?: Record<string, ProviderConfig>;
};

export type OpenClashConfig = {
  server: ServerConfig;
  providers: Record<string, ProviderConfig>;
};

/** Get the route prefix for a provider: /{providerKey} */
export function providerPrefix(providerKey: string): string {
  return `/${providerKey}`;
}

/** Generate a random apiKey: oc-{providerKey}-{random} */
export function generateApiKey(providerKey: string): string {
  return `oc-${providerKey}-${crypto.randomBytes(16).toString("hex")}`;
}
