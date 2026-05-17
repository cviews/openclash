import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { OpenAIMessage } from "../shared/types.js";

/**
 * Convert OpenAI messages array into ACP ContentBlock[].
 *
 * Since we create a fresh ACP session per request, the full conversation
 * history is flattened into content blocks with role markers so the
 * ACP agent receives the complete context.
 */
export function convertMessagesToContentBlocks(messages: OpenAIMessage[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const msg of messages) {
    if (msg.content == null) continue;

    let text: string;
    switch (msg.role) {
      case "system":
        text = `[System Instructions]\n${msg.content}`;
        break;
      case "assistant":
        text = `[Assistant]\n${msg.content}`;
        break;
      case "tool":
        text = `[Tool Result${msg.tool_call_id ? ` (${msg.tool_call_id})` : ""}]\n${msg.content}`;
        break;
      case "user":
      default:
        text = msg.content;
        break;
    }

    blocks.push({ type: "text", text });
  }

  return blocks;
}
