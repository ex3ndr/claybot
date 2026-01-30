import type { ToolCall, ToolResultMessage, Tool } from "@mariozechner/pi-ai";
import { validateToolCall } from "@mariozechner/pi-ai";

import { getLogger } from "../../log.js";
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./types.js";

const logger = getLogger("tools.registry");

type RegisteredTool = ToolDefinition & { pluginId: string };

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(pluginId: string, definition: ToolDefinition): void {
    this.tools.set(definition.tool.name, { ...definition, pluginId });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [name, entry] of this.tools.entries()) {
      if (entry.pluginId === pluginId) {
        this.tools.delete(name);
      }
    }
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values()).map((entry) => entry.tool);
  }

  async execute(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const entry = this.tools.get(toolCall.name);
    if (!entry) {
      return {
        toolMessage: buildToolError(toolCall, `Unknown tool: ${toolCall.name}`)
      };
    }

    try {
      const args = validateToolCall([entry.tool], toolCall);
      const result = await entry.execute(args, context, toolCall);
      if (!result.toolMessage.toolCallId) {
        result.toolMessage.toolCallId = toolCall.id;
      }
      if (!result.toolMessage.toolName) {
        result.toolMessage.toolName = toolCall.name;
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tool execution failed.";
      logger.warn({ tool: toolCall.name, error }, "Tool execution failed");
      return { toolMessage: buildToolError(toolCall, message) };
    }
  }
}

function buildToolError(
  toolCall: ToolCall,
  text: string
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    isError: true,
    timestamp: Date.now()
  };
}
