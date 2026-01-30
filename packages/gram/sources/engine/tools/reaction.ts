import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "./types.js";

const schema = Type.Object(
  {
    reaction: Type.String({ minLength: 1 }),
    messageId: Type.Optional(Type.String({ minLength: 1 })),
    source: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

type ReactionArgs = Static<typeof schema>;

export function buildReactionTool(): ToolDefinition {
  return {
    tool: {
      name: "set_reaction",
      description: "Set a reaction emoji on a message in the active connector.",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as ReactionArgs;
      if (!toolContext.connectorRegistry) {
        throw new Error("Connector registry unavailable");
      }
      const source = payload.source ?? toolContext.source;
      const connector = toolContext.connectorRegistry.get(source);
      if (!connector || !connector.setReaction) {
        throw new Error(`Connector does not support reactions: ${source}`);
      }
      const messageId = payload.messageId ?? toolContext.messageContext.messageId;
      if (!messageId) {
        throw new Error("Missing message id for reaction");
      }
      await connector.setReaction(
        toolContext.messageContext.channelId,
        String(messageId),
        payload.reaction
      );

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: `Reaction set: ${payload.reaction}` }],
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}
