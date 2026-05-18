import { spawn, type ChildProcess } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { createRequire } from "node:module";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionNotification,
  type ContentBlock,
  type Client,
  type Agent,
  type PromptResponse,
} from "@agentclientprotocol/sdk";
import type { AcpProviderOptions } from "../../config/types.js";
import { AsyncQueue } from "../../shared/async-queue.js";
import { logger } from "../../shared/logger.js";

const TAG = "acp-client";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../../../package.json");

/**
 * AcpClient manages a single ACP agent subprocess and its JSON-RPC connection.
 * One client per configured ACP provider; the subprocess is long-lived and
 * reused across multiple OpenAI requests.
 */
export class AcpClient {
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private alive = false;

  /** Active queues for concurrent prompt streams, keyed by sessionId */
  private activeQueues = new Map<string, AsyncQueue<SessionNotification>>();

  constructor(private readonly options: AcpProviderOptions) {}

  /**
   * Spawn the ACP subprocess and perform Initialize + Authenticate handshake.
   */
  async connect(): Promise<void> {
    logger.info(TAG, `Spawning ACP subprocess: ${this.options.command} ${(this.options.args ?? []).join(" ")}`);

    const child = spawn(this.options.command, this.options.args ?? [], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...this.options.env },
    });

    this.process = child;

    child.on("exit", (code) => {
      this.alive = false;
      if (code !== 0) {
        logger.error(TAG, `ACP subprocess exited with code ${code}`);
      } else {
        logger.info(TAG, "ACP subprocess exited normally");
      }
      // Abort all active queues on exit
      for (const queue of this.activeQueues.values()) {
        queue.abort(new Error(`ACP subprocess exited (code ${code})`));
      }
      this.activeQueues.clear();
    });

    child.on("error", (err) => {
      this.alive = false;
      logger.error(TAG, "ACP subprocess error", err);
    });

    if (!child.stdin || !child.stdout) {
      throw new Error("Failed to get subprocess stdio pipes");
    }

    // Convert Node.js streams to Web Streams for ndJsonStream
    const stdinWritable = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const stdoutReadable = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;

    // ndJsonStream(output: WritableStream, input: ReadableStream)
    const stream = ndJsonStream(stdinWritable, stdoutReadable);

    const activeQueues = this.activeQueues;

    this.connection = new ClientSideConnection((_agent: Agent) => {
      const client: Client = {
        async sessionUpdate(notification: SessionNotification) {
          const queue = activeQueues.get(notification.sessionId);
          if (queue) {
            queue.push(notification);
          }
        },
        async requestPermission() {
          // Gateway mode: auto-allow all permissions
          return { outcome: { outcome: "cancelled" as const } };
        },
        async readTextFile() {
          throw new Error("readTextFile not supported in gateway mode");
        },
        async writeTextFile() {
          throw new Error("writeTextFile not supported in gateway mode");
        },
      };
      return client;
    }, stream);

    // Initialize handshake
    const initResult = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "openclash", version: PKG_VERSION },
      clientCapabilities: {},
    });

    logger.info(TAG, `ACP initialized: ${JSON.stringify(initResult.agentInfo ?? {})}`);

    // Authenticate if required.
    const hasApiKeyArg = this.options.args?.includes("--api-key");

    if (initResult.authMethods && initResult.authMethods.length > 0) {
      logger.debug(TAG, `Available authMethods: ${JSON.stringify(initResult.authMethods)}`);

      // Priority: api_key > env_var > first available
      const apiKeyMethod = initResult.authMethods.find((m: any) => m.type === "api_key" || m.id === "api_key");
      const envVarMethod = initResult.authMethods.find((m: any) => m.type === "env_var");
      const authMethod = apiKeyMethod ?? envVarMethod ?? initResult.authMethods[0]!;
      const methodId = (authMethod as any).id ?? "unknown";

      logger.info(TAG, `Authenticating with method: ${methodId}${hasApiKeyArg ? " (--api-key in args)" : ""}`);
      await this.connection.authenticate({ methodId });
      logger.info(TAG, "ACP authenticated successfully");
    }

    this.alive = true;
  }

  /**
   * Create a new ACP session. Returns the sessionId and available configOptions.
   */
  async createSession(cwd?: string): Promise<{ sessionId: string; configOptions: any[] }> {
    if (!this.connection) throw new Error("ACP client not connected");

    const result = await this.connection.newSession({
      cwd: cwd ?? process.cwd(),
      mcpServers: [],
    });

    const configOptions = (result as any).configOptions ?? [];
    logger.debug(TAG, `Session created: ${result.sessionId}, configOptions: ${JSON.stringify(configOptions)}`);
    return { sessionId: result.sessionId, configOptions };
  }

  /**
   * Set the model for an ACP session. Best-effort; not all agents support it.
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    if (!this.connection) return;
    try {
      await (this.connection as any).setSessionModel({ sessionId, modelId });
      logger.debug(TAG, `Session ${sessionId} model set to ${modelId}`);
    } catch {
      // Not all ACP agents support setSessionModel — silently ignore
    }
  }

  /**
   * Set a session config option. Best-effort; not all agents support it.
   */
  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void> {
    if (!this.connection) return;
    try {
      const params = typeof value === "boolean"
        ? { sessionId, configId, type: "boolean" as const, value }
        : { sessionId, configId, value };
      await this.connection.setSessionConfigOption(params);
      logger.debug(TAG, `Session ${sessionId} config "${configId}" set to ${JSON.stringify(value)}`);
    } catch (err) {
      logger.debug(TAG, `Failed to set config "${configId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Send a prompt and return an AsyncGenerator of session notifications.
   * The generator yields until the prompt turn completes.
   */
  async *prompt(
    sessionId: string,
    contentBlocks: ContentBlock[],
    signal?: AbortSignal,
  ): AsyncGenerator<SessionNotification> {
    if (!this.connection) throw new Error("ACP client not connected");

    const queue = new AsyncQueue<SessionNotification>();
    this.activeQueues.set(sessionId, queue);

    // Handle abort
    const onAbort = () => {
      queue.abort(new Error("Request aborted"));
      this.activeQueues.delete(sessionId);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // Start the prompt RPC call (resolves when the turn ends)
    const promptPromise = this.connection.prompt({
      sessionId,
      prompt: contentBlocks,
    }).then((response) => {
      queue.finish();
      return response;
    }).catch((err: unknown) => {
      queue.abort(err instanceof Error ? err : new Error(String(err)));
      return null;
    }).finally(() => {
      this.activeQueues.delete(sessionId);
      signal?.removeEventListener("abort", onAbort);
    });

    // Yield notifications as they arrive via the queue
    for await (const notification of queue) {
      yield notification;
    }

    // The prompt result contains stopReason + usage, yield it as a final sentinel
    const promptResult = await promptPromise;
    if (promptResult) {
      // Emit a synthetic notification carrying the prompt result
      yield {
        sessionId,
        update: {
          sessionUpdate: "__prompt_result__",
          stopReason: promptResult.stopReason,
          usage: promptResult.usage,
        },
      } as unknown as SessionNotification;
    }
  }

  /** Whether the subprocess is still running */
  isAlive(): boolean {
    return this.alive && this.process !== null;
  }

  /** Kill the subprocess */
  async shutdown(): Promise<void> {
    this.alive = false;
    for (const queue of this.activeQueues.values()) {
      queue.finish();
    }
    this.activeQueues.clear();

    if (this.process) {
      this.process.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.process?.kill("SIGKILL");
          resolve();
        }, 5000);
        this.process!.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.process = null;
    }
    this.connection = null;
  }
}
