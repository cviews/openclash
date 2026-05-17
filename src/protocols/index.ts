import type { ProtocolAdapter } from "./adapter.js";
import type { ProviderConfig } from "../config/types.js";
import { AcpAdapter } from "./acp/adapter.js";

export type { ProtocolAdapter } from "./adapter.js";

/**
 * Factory: create a ProtocolAdapter based on the provider type.
 * Currently supports "acp"; extensible for future protocol types.
 */
export function createAdapter(id: string, config: ProviderConfig): ProtocolAdapter {
  switch (config.type) {
    case "acp":
      return new AcpAdapter(id, config);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}
