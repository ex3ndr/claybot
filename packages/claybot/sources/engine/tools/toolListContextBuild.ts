import type { Tool } from "@mariozechner/pi-ai";

import type { ConnectorRegistry, ImageGenerationRegistry } from "../modules.js";

type ToolListOptions = {
  tools: Tool[];
  source?: string;
  agentKind?: "background" | "foreground";
  allowCronTools?: boolean;
  connectorRegistry: Pick<ConnectorRegistry, "get" | "list">;
  imageRegistry: Pick<ImageGenerationRegistry, "list">;
};

const BACKGROUND_TOOL_DENYLIST = new Set([
  "request_permission",
  "set_reaction",
  "send_file"
]);

/**
 * Builds the tool list for a session context based on connector capabilities.
 * Expects: tool names are unique; connector registry is available for capability checks.
 */
export function toolListContextBuild(options: ToolListOptions): Tool[] {
  const source = options.source;
  let tools = options.tools;
  if (source && source !== "cron" && !options.allowCronTools) {
    tools = tools.filter(
      (tool) => tool.name !== "cron_read_memory" && tool.name !== "cron_write_memory"
    );
  }
  if (options.agentKind === "background") {
    tools = tools.filter((tool) => !BACKGROUND_TOOL_DENYLIST.has(tool.name));
  }
  const connectorCapabilities = source
    ? options.connectorRegistry.get(source)?.capabilities ?? null
    : null;
  const supportsFiles = source
    ? (connectorCapabilities?.sendFiles?.modes.length ?? 0) > 0
    : options
        .connectorRegistry
        .list()
        .some(
          (id) =>
            (options.connectorRegistry.get(id)?.capabilities.sendFiles?.modes.length ?? 0) > 0
        );
  const supportsReactions = source
    ? connectorCapabilities?.reactions === true
    : options
        .connectorRegistry
        .list()
        .some((id) => options.connectorRegistry.get(id)?.capabilities.reactions === true);

  let filtered = tools;
  if (options.imageRegistry.list().length === 0) {
    filtered = filtered.filter((tool) => tool.name !== "generate_image");
  }
  return toolListFilterConnectorCapabilities(filtered, supportsFiles, supportsReactions);
}

function toolListFilterConnectorCapabilities<T extends { name: string }>(
  tools: T[],
  supportsFiles: boolean,
  supportsReactions: boolean
): T[] {
  let filtered: T[] = tools;
  if (!supportsFiles) {
    filtered = filtered.filter((tool) => tool.name !== "send_file");
  }
  if (!supportsReactions) {
    filtered = filtered.filter((tool) => tool.name !== "set_reaction");
  }
  return filtered;
}
