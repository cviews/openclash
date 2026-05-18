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

/**
 * Check if an existing OpenClash gateway is already running on the given port
 * by hitting its /health endpoint.
 */
export async function isOpenClashRunning(
  port: number,
  host: string,
): Promise<boolean> {
  try {
    const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/health`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const body = await res.json() as { status?: string };
    return body.status === "ok";
  } catch {
    return false;
  }
}
