import { createId } from "@paralleldrive/cuid2";
import type { Context } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type {
  AgentHistoryRecord,
  ToolDefinition,
  ToolExecutionContext
} from "@/types";
import { listActiveInferenceProviders, getProviderDefinition } from "../../../providers/catalog.js";
import { providerModelSelectBySize } from "../../../providers/providerModelSelectBySize.js";
import { stringTruncate } from "../../../utils/stringTruncate.js";
import { agentDescriptorRead } from "../../agents/ops/agentDescriptorRead.js";
import { agentHistoryLoad } from "../../agents/ops/agentHistoryLoad.js";
import { agentHistorySummaryBuild } from "../../agents/ops/agentHistorySummaryBuild.js";
import { agentPromptBundledRead } from "../../agents/ops/agentPromptBundledRead.js";
import { messageExtractText } from "../../messages/messageExtractText.js";
import { toolResultFormatVerbose } from "./toolResultFormatVerbose.js";

const schema = Type.Object(
  {
    agentId: Type.String({ minLength: 1 }),
    summarized: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

type SessionHistoryArgs = Static<typeof schema>;

const MAX_SUMMARY_RECORDS = 400;
const MAX_SUMMARY_INPUT_CHARS = 120_000;

/**
 * Builds the read_session_history tool for cross-session visibility.
 * Expects: agentId references another persisted agent/session id.
 */
export function sessionHistoryToolBuild(): ToolDefinition {
  return {
    tool: {
      name: "read_session_history",
      description:
        "Read another session's history by agentId. Returns a summary by default (summarized=true).",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as SessionHistoryArgs;
      const agentId = payload.agentId.trim();
      if (!agentId) {
        throw new Error("agentId is required.");
      }
      if (agentId === toolContext.agent.id) {
        throw new Error("agentId must refer to another session.");
      }

      const config = toolContext.agentSystem.config.current;
      const descriptor = await agentDescriptorRead(config, agentId);
      if (!descriptor) {
        throw new Error(`Agent session not found: ${agentId}`);
      }

      const records = await agentHistoryLoad(config, agentId);
      const summarized = payload.summarized ?? true;
      const text = summarized
        ? await summaryTextGenerate(agentId, records, toolContext)
        : rawHistoryTextBuild(agentId, records);

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text }],
        details: {
          agentId,
          summarized,
          recordCount: records.length
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}

async function summaryTextGenerate(
  agentId: string,
  records: AgentHistoryRecord[],
  toolContext: ToolExecutionContext
): Promise<string> {
  if (records.length === 0) {
    return `No history records found for agent ${agentId}.`;
  }
  const providers = listActiveInferenceProviders(
    toolContext.agentSystem.config.current.settings
  );
  if (providers.length === 0) {
    throw new Error("No inference provider available.");
  }
  const providersOverride = providers.map((provider) => {
    const definition = getProviderDefinition(provider.id);
    const normalModel = providerModelSelectBySize(definition?.models ?? [], "normal");
    return normalModel ? { ...provider, model: normalModel } : { ...provider };
  });

  const summaryPrompt = (await agentPromptBundledRead("COMPACTION.md")).trim();
  const summaryContext: Context = {
    systemPrompt: summaryPrompt,
    messages: [
      {
        role: "user",
        content: summaryInputBuild(agentId, records),
        timestamp: Date.now()
      }
    ]
  };

  const response = await toolContext.agentSystem.inferenceRouter.complete(
    summaryContext,
    `session-history-summary:${createId()}`,
    { providersOverride }
  );
  const summaryText = messageExtractText(response.message)?.trim();
  if (!summaryText) {
    throw new Error("Summarization model returned empty output.");
  }
  return [`Agent ${agentId} session summary:`, summaryText].join("\n");
}

function rawHistoryTextBuild(agentId: string, records: AgentHistoryRecord[]): string {
  if (records.length === 0) {
    return `No history records found for agent ${agentId}.`;
  }
  return [
    `Agent ${agentId} full session history (${records.length} records):`,
    JSON.stringify(records, null, 2)
  ].join("\n");
}

function summaryInputBuild(agentId: string, records: AgentHistoryRecord[]): string {
  const summary = agentHistorySummaryBuild(records);
  const tail = records.slice(-MAX_SUMMARY_RECORDS);
  const omittedCount = records.length - tail.length;
  const lines = [
    `Summarize this agent session history: ${agentId}`,
    `record_count: ${summary.recordCount}`,
    `range: ${formatTimestamp(summary.firstAt)} -> ${formatTimestamp(summary.lastAt)}`,
    [
      `types: start=${summary.counts.start}`,
      `reset=${summary.counts.reset}`,
      `user=${summary.counts.user_message}`,
      `assistant=${summary.counts.assistant_message}`,
      `tool_result=${summary.counts.tool_result}`,
      `note=${summary.counts.note}`
    ].join(" "),
    omittedCount > 0
      ? `Only last ${tail.length} records are included below (${omittedCount} earlier records omitted).`
      : "All records are included below.",
    "History:"
  ];

  for (const record of tail) {
    lines.push(recordSummaryLineBuild(record));
  }
  return stringTruncate(lines.join("\n"), MAX_SUMMARY_INPUT_CHARS);
}

function recordSummaryLineBuild(record: AgentHistoryRecord): string {
  const prefix = `[${formatTimestamp(record.at)}]`;
  if (record.type === "start") {
    return `${prefix} start`;
  }
  if (record.type === "reset") {
    return `${prefix} reset ${record.message ? `message="${singleLine(record.message)}"` : ""}`.trim();
  }
  if (record.type === "user_message") {
    return `${prefix} user_message text="${singleLine(stringTruncate(record.text, 700))}"`;
  }
  if (record.type === "assistant_message") {
    return `${prefix} assistant_message text="${singleLine(stringTruncate(record.text, 700))}"`;
  }
  if (record.type === "note") {
    return `${prefix} note text="${singleLine(stringTruncate(record.text, 400))}"`;
  }
  return `${prefix} tool_result toolCallId=${record.toolCallId} ${singleLine(toolResultFormatVerbose(record.output))}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatTimestamp(at: number | null): string {
  if (at === null) {
    return "unknown";
  }
  return new Date(at).toISOString();
}
