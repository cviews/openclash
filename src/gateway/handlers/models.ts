import type { Context } from "hono";
import type { ProtocolAdapter } from "../../protocols/adapter.js";
import type { ProviderConfig } from "../../config/types.js";
import type { ModelListResponse } from "../../shared/types.js";

/**
 * GET /{prefix}/v1/models - List available models for a provider.
 */
export function modelsHandler(adapter: ProtocolAdapter, config: ProviderConfig) {
  return (c: Context) => {
    const models = adapter.listModels();
    const now = Math.floor(Date.now() / 1000);

    const response: ModelListResponse = {
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model" as const,
        created: now,
        owned_by: config.name,
      })),
    };

    return c.json(response);
  };
}
