import type { ToolCall, ToolResultMessage, Tool } from "@mariozechner/pi-ai";
import { validateToolCall } from "@mariozechner/pi-ai";

import { getLogger } from "../../log.js";
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "@/types";
import { toolResultTruncate } from "./tools/toolResultTruncate.js";

type RegisteredTool = ToolDefinition & { pluginId: string };

const logger = getLogger("engine.modules");

export class ToolResolver {
  private tools = new Map<string, RegisteredTool>();

  register(pluginId: string, definition: ToolDefinition): void {
    logger.debug(`Registering tool pluginId=${pluginId} toolName=${definition.tool.name}`);
    this.tools.set(definition.tool.name, { ...definition, pluginId });
    logger.debug(`Tool registered totalTools=${this.tools.size}`);
  }

  unregister(name: string): void {
    logger.debug(`Unregistering tool toolName=${name}`);
    this.tools.delete(name);
  }

  unregisterByPlugin(pluginId: string): void {
    logger.debug(`Unregistering tools by plugin pluginId=${pluginId}`);
    let count = 0;
    for (const [name, entry] of this.tools.entries()) {
      if (entry.pluginId === pluginId) {
        this.tools.delete(name);
        count++;
      }
    }
    logger.debug(`Tools unregistered by plugin pluginId=${pluginId} unregisteredCount=${count}`);
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values()).map((entry) => entry.tool);
  }

  async execute(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const argsPreview = JSON.stringify(toolCall.arguments).slice(0, 100);
    logger.debug(`execute() called toolName=${toolCall.name} toolCallId=${toolCall.id} argsPreview=${argsPreview}`);
    const entry = this.tools.get(toolCall.name);
    if (!entry) {
      const availableTools = Array.from(this.tools.keys()).join(",");
      logger.debug(`Tool not found toolName=${toolCall.name} availableTools=${availableTools}`);
      return {
        toolMessage: buildToolError(toolCall, `Unknown tool: ${toolCall.name}`),
        files: []
      };
    }

    try {
      logger.debug(`Validating tool call arguments toolName=${toolCall.name}`);
      const args = validateToolCall([entry.tool], toolCall);
      logger.debug(`Arguments validated, executing tool toolName=${toolCall.name}`);
      const startTime = Date.now();
      const result = await entry.execute(args, context, toolCall);
      const duration = Date.now() - startTime;
      logger.debug(`Tool execution completed toolName=${toolCall.name} durationMs=${duration} isError=${result.toolMessage.isError} fileCount=${result.files.length}`);
      if (!result.toolMessage.toolCallId) {
        result.toolMessage.toolCallId = toolCall.id;
      }
      if (!result.toolMessage.toolName) {
        result.toolMessage.toolName = toolCall.name;
      }
      return toolResultTruncate(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      logger.debug(`Tool execution threw error toolName=${toolCall.name} error=${String(error)}`);
      logger.warn({ tool: toolCall.name, error }, "Tool execution failed");
      return { toolMessage: buildToolError(toolCall, message), files: [] };
    }
  }
}

function buildToolError(toolCall: ToolCall, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    isError: true,
    timestamp: Date.now()
  };
}
