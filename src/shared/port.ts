import { createServer } from "node:net";

/**
 * Check if a port is available on the given host.
 */
export function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

export interface HealthCheckOptions {
  retries?: number;
  delay?: number;
}

/**
 * Check if an existing OpenClash gateway is already running on the given port
 * by hitting its /health endpoint. Supports retries for cases where the gateway
 * is still starting up.
 */
export async function isOpenClashRunning(
  port: number,
  host: string,
  options?: HealthCheckOptions,
): Promise<boolean> {
  const retries = options?.retries ?? 1;
  const delay = options?.delay ?? 0;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0 && delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/health`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const body = await res.json() as { status?: string };
      if (body.status === "ok") return true;
    } catch {
      // Connection refused or timeout — try again
    }
  }
  return false;
}
