import type { ProtocolAdapter } from "../adapter.js";
import type { ProviderConfig } from "../../config/types.js";
import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from "../../shared/types.js";
import { serviceUnavailable, modelNotFound } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import { AcpClient } from "./client.js";
import {
  convertMessagesToContentBlocks,
  sessionUpdateToChunk,
  createRoleChunk,
  createFinishChunk,
  convertStopReason,
  assembleResponse,
  UsageTracker,
} from "../../converters/index.js";

const TAG = "acp-adapter";

/**
 * AcpAdapter implements ProtocolAdapter for ACP-based providers.
 * Manages a long-lived ACP subprocess, creates a new session per
 * incoming OpenAI request (stateless gateway). Uses UsageTracker
 * to ensure every response has accurate token counts.
 */
export class AcpAdapter implements ProtocolAdapter {
  readonly id: string;
  private client: AcpClient;
  private config: ProviderConfig;
  private connecting = false;

  constructor(id: string, config: ProviderConfig) {
    this.id = id;
    this.config = config;
    this.client = new AcpClient(config.options);
  }

  async initialize(): Promise<void> {
    await this.ensureConnected();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isAlive()) return;
    if (this.connecting) {
      while (this.connecting) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.client.isAlive()) return;
    }

    this.connecting = true;
    try {
      this.client = new AcpClient(this.config.options);
      await this.client.connect();
    } finally {
      this.connecting = false;
    }
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.validateModel(request.model);
    await this.ensureConnected();

    const requestId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const contentBlocks = convertMessagesToContentBlocks(request.messages);

    const usage = new UsageTracker();
    usage.setPromptLength(request.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0));

    const sessionId = await this.setupSession(request.model, request.options);

    let fullContent = "";
    let stopReason: string | undefined;

    try {
      const controller = new AbortController();
      for await (const notification of this.client.prompt(sessionId, contentBlocks, controller.signal)) {
        const update = (notification as any).update;
        if (!update) continue;

        if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
          fullContent += update.content.text;
          usage.addCompletionChars(update.content.text.length);
        } else if (update.sessionUpdate === "__prompt_result__") {
          stopReason = update.stopReason;
          usage.setAcpUsage(update.usage);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      const errData = (err as any)?.data ?? (err as any)?.cause;
      logger.error(TAG, `Completion failed for ${this.id}: ${errMsg}`);
      if (errData) logger.error(TAG, `Error data: ${JSON.stringify(errData)}`);
      if (errStack) logger.debug(TAG, errStack);
      throw serviceUnavailable(`ACP provider ${this.id} failed: ${errMsg}`);
    }

    return assembleResponse(requestId, request.model, created, fullContent, convertStopReason(stopReason), usage.resolve());
  }

  async *stream(request: ChatCompletionRequest, signal: AbortSignal): AsyncGenerator<ChatCompletionChunk> {
    this.validateModel(request.model);
    await this.ensureConnected();

    const requestId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const contentBlocks = convertMessagesToContentBlocks(request.messages);

    const usage = new UsageTracker();
    usage.setPromptLength(request.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0));

    const sessionId = await this.setupSession(request.model, request.options);

    yield createRoleChunk(requestId, request.model, created);

    let stopReason: string | undefined;

    try {
      for await (const notification of this.client.prompt(sessionId, contentBlocks, signal)) {
        const update = (notification as any).update;
        if (!update) continue;

        if (update.sessionUpdate === "__prompt_result__") {
          stopReason = update.stopReason;
          usage.setAcpUsage(update.usage);
          continue;
        }

        // Track completion chars for usage estimation
        if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
          usage.addCompletionChars(update.content.text.length);
        }

        const chunk = sessionUpdateToChunk(update, requestId, request.model, created);
        if (chunk) yield chunk;
      }
    } catch (err) {
      if (signal.aborted) return;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      const errData = (err as any)?.data ?? (err as any)?.cause;
      logger.error(TAG, `Stream failed for ${this.id}: ${errMsg}`);
      if (errData) logger.error(TAG, `Error data: ${JSON.stringify(errData)}`);
      if (errStack) logger.debug(TAG, errStack);
      throw serviceUnavailable(`ACP provider ${this.id} stream failed: ${errMsg}`);
    }

    yield createFinishChunk(requestId, request.model, created, convertStopReason(stopReason), usage.resolve());
  }

  listModels(): Array<{ id: string; name: string }> {
    return Object.entries(this.config.models).map(([key, model]) => ({
      id: model.id ?? key,
      name: model.name,
    }));
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }

  private async setupSession(model: string, options?: Record<string, unknown>): Promise<string> {
    let sessionId: string;
    let configOptions: any[];

    try {
      const result = await this.client.createSession();
      sessionId = result.sessionId;
      configOptions = result.configOptions;
      logger.debug(TAG, `Session created: ${sessionId}, configOptions: ${JSON.stringify(configOptions.map((c: any) => c.id ?? c.category))}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errData = (err as any)?.data ?? (err as any)?.cause;
      logger.error(TAG, `Failed to create session for ${this.id}: ${errMsg}`);
      if (errData) logger.error(TAG, `Error data: ${JSON.stringify(errData)}`);
      throw err;
    }

    // Set model — prefer configOption if available (e.g. Cursor), fallback to setSessionModel
    const modelConfig = configOptions.find((c: any) => c.category === "model");
    if (modelConfig) {
      const modelOptions = modelConfig.options ?? [];
      logger.debug(TAG, `Available model options: ${JSON.stringify(modelOptions.map((o: any) => ({ name: o.name, value: o.value })))}`);
      const match = modelOptions.find((o: any) =>
        o.name === model || o.value === model || o.value?.startsWith(`${model}[`),
      ) ?? modelOptions.find((o: any) => {
        // Fuzzy match: normalize dots to dashes and check if name contains model or vice versa
        const normalized = model.replace(/\./g, "-");
        const oName = (o.name as string).toLowerCase();
        const oValue = (o.value as string).toLowerCase();
        return oName.includes(normalized) || oValue.includes(normalized)
          || oName.endsWith(normalized) || oValue.startsWith(normalized);
      });
      if (match) {
        await this.client.setConfigOption(sessionId, modelConfig.id, match.value);
      } else {
        logger.debug(TAG, `Model "${model}" not found in configOptions, using setSessionModel`);
        await this.client.setModel(sessionId, model).catch((err) => {
          logger.warn(TAG, `setSessionModel("${model}") failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } else {
      await this.client.setModel(sessionId, model).catch((err) => {
        logger.warn(TAG, `setSessionModel("${model}") failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    if (options && configOptions.length > 0) {
      await this.applyOptions(sessionId, configOptions, options);
    }
    return sessionId;
  }

  /**
   * Map request options to ACP session config options.
   * Matches options by configId or category (e.g. "thinking" → thought_level config).
   */
  private async applyOptions(
    sessionId: string,
    configOptions: any[],
    options: Record<string, unknown>,
  ): Promise<void> {
    for (const [key, value] of Object.entries(options)) {
      // Try direct match by config id
      let config = configOptions.find((c: any) => c.id === key);

      // Try match by category (e.g. "thinking" → category "thought_level")
      if (!config) {
        config = configOptions.find((c: any) => c.category === key);
      }

      // Try common aliases: "thinking" → "thought_level" category
      if (!config && key === "thinking") {
        config = configOptions.find((c: any) => c.category === "thought_level");
      }

      if (!config) {
        logger.debug(TAG, `No matching config option for "${key}", skipping`);
        continue;
      }

      // Resolve the value to set
      let resolvedValue: string | boolean;
      if (config.type === "boolean") {
        resolvedValue = typeof value === "object" && value !== null
          ? (value as any).type === "enabled" || (value as any).enabled === true
          : Boolean(value);
      } else if (config.type === "select") {
        // For select type, value could be { type: "enabled" } or a direct value id
        if (typeof value === "string") {
          resolvedValue = value;
        } else if (typeof value === "object" && value !== null) {
          // Try to find a matching option value from the config's available values
          const selectConfig = config as any;
          const values = selectConfig.values ?? [];
          const targetType = (value as any).type;
          if (targetType) {
            const match = values.find((v: any) => v.id === targetType || v.label?.toLowerCase() === targetType);
            resolvedValue = match?.id ?? targetType;
          } else {
            resolvedValue = String(value);
          }
        } else {
          resolvedValue = String(value);
        }
      } else {
        resolvedValue = typeof value === "string" ? value : String(value);
      }

      await this.client.setConfigOption(sessionId, config.id, resolvedValue);
    }
  }

  private validateModel(model: string): void {
    const models = this.config.models;
    if (!models[model] && !Object.values(models).some((m) => m.id === model)) {
      throw modelNotFound(model);
    }
  }
}
