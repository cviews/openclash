import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CONFIG_FILE_NAME = "openclash.json";

export function resolveConfigDir(): string {
  if (process.env["OPENCLASH_CONFIG_DIR"]) {
    return process.env["OPENCLASH_CONFIG_DIR"];
  }
  const xdgConfig = process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "openclash");
}

export function resolveConfigPath(): string {
  if (process.env["OPENCLASH_CONFIG"]) {
    return process.env["OPENCLASH_CONFIG"];
  }
  return path.join(resolveConfigDir(), CONFIG_FILE_NAME);
}

export function loadConfigFile(configPath?: string): Record<string, unknown> {
  const filePath = configPath ?? resolveConfigPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}
