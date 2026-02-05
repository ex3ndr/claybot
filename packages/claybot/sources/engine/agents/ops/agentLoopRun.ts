import type { Context } from "@mariozechner/pi-ai";
import type { Logger } from "pino";

import type { FileStore } from "../../../files/store.js";
import type { FileReference } from "@/types";
import type { AuthStore } from "../../../auth/store.js";
import type { AssistantSettings, ProviderSettings } from "../../../settings.js";
import type { Connector } from "@/types";
import type { ConnectorRegistry } from "../../modules/connectorRegistry.js";
import type { ToolResolver } from "../../modules/toolResolver.js";
import type { InferenceRouter } from "../../modules/inference/router.js";
import { messageExtractText } from "../../messages/messageExtractText.js";
import { messageExtractToolCalls } from "../../messages/messageExtractToolCalls.js";
import { messageNoMessageIs } from "../../messages/messageNoMessageIs.js";
import { toolArgsFormatVerbose } from "../../modules/tools/toolArgsFormatVerbose.js";
import { toolResultFormatVerbose } from "../../modules/tools/toolResultFormatVerbose.js";
import type { EngineEventBus } from "../../ipc/events.js";
import type { Agent } from "../agent.js";
import type { AgentHistoryRecord, AgentMessage } from "./agentTypes.js";
import { agentDescriptorTargetResolve } from "./agentDescriptorTargetResolve.js";
import type { AgentSystem } from "../agentSystem.js";
import type { Heartbeats } from "../../heartbeat/heartbeats.js";
import { tokensResolve } from "./tokensResolve.js";

const MAX_TOOL_ITERATIONS = 5;

type AgentLoopRunOptions = {
  entry: AgentMessage;
  agent: Agent;
  source: string;
  context: Context;
  connector: Connector | null;
  connectorRegistry: ConnectorRegistry;
  inferenceRouter: InferenceRouter;
  toolResolver: ToolResolver;
  fileStore: FileStore;
  authStore: AuthStore;
  eventBus: EngineEventBus;
  assistant: AssistantSettings | null;
  agentSystem: AgentSystem;
  heartbeats: Heartbeats;
  providersForAgent: ProviderSettings[];
  verbose: boolean;
  logger: Logger;
  notifySubagentFailure: (reason: string, error?: unknown) => Promise<void>;
};

type AgentLoopResult = {
  responseText?: string | null;
  historyRecords: AgentHistoryRecord[];
  contextOverflow?: boolean;
  tokenStatsUpdates: Array<{
    provider: string;
    model: string;
    size: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  }>;
};

/**
 * Runs the agent inference loop and handles tool execution + response delivery.
 * Expects: context already includes the user message and system prompt.
 */
export async function agentLoopRun(options: AgentLoopRunOptions): Promise<AgentLoopResult> {
  const {
    entry,
    agent,
    source,
    context,
    connector,
    connectorRegistry,
    inferenceRouter,
    toolResolver,
    fileStore,
    authStore,
    eventBus,
    assistant,
    agentSystem,
    heartbeats,
    providersForAgent,
    verbose,
    logger,
    notifySubagentFailure
  } = options;

  let response: Awaited<ReturnType<InferenceRouter["complete"]>> | null = null;
  let toolLoopExceeded = false;
  let lastResponseHadToolCalls = false;
  const generatedFiles: FileReference[] = [];
  let lastResponseTextSent = false;
  let finalResponseText: string | null = null;
  let lastResponseNoMessage = false;
  const historyRecords: AgentHistoryRecord[] = [];
  const tokenStatsUpdates: AgentLoopResult["tokenStatsUpdates"] = [];
  const target = agentDescriptorTargetResolve(agent.descriptor);
  const targetId = target?.targetId ?? null;
  logger.debug(`Starting typing indicator targetId=${targetId ?? "none"}`);
  const stopTyping = targetId ? connector?.startTyping?.(targetId) : null;

  try {
    logger.debug(`Starting inference loop maxIterations=${MAX_TOOL_ITERATIONS}`);
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      logger.debug(
        `Inference loop iteration=${iteration} agentId=${agent.id} messageCount=${context.messages.length}`
      );
      response = await inferenceRouter.complete(context, agent.id, {
        providersOverride: providersForAgent,
        onAttempt: (providerId, modelId) => {
          logger.debug(
            `Inference attempt starting providerId=${providerId} modelId=${modelId} agentId=${agent.id}`
          );
          logger.info(
            { agentId: agent.id, messageId: entry.id, provider: providerId, model: modelId },
            "Inference started"
          );
        },
        onFallback: (providerId, error) => {
          logger.debug(
            `Inference falling back to next provider providerId=${providerId} error=${String(error)}`
          );
          logger.warn(
            { agentId: agent.id, messageId: entry.id, provider: providerId, error },
            "Inference fallback"
          );
        },
        onSuccess: (providerId, modelId, message) => {
          logger.debug(
            `Inference succeeded providerId=${providerId} modelId=${modelId} stopReason=${message.stopReason} inputTokens=${message.usage?.input} outputTokens=${message.usage?.output}`
          );
          logger.info(
            {
              agentId: agent.id,
              messageId: entry.id,
              provider: providerId,
              model: modelId,
              stopReason: message.stopReason,
              usage: message.usage
            },
            "Inference completed"
          );
        },
        onFailure: (providerId, error) => {
          logger.debug(
            `Inference failed completely providerId=${providerId} error=${String(error)}`
          );
          logger.warn(
            { agentId: agent.id, messageId: entry.id, provider: providerId, error },
            "Inference failed"
          );
        }
      });

      const tokenUsage = tokensResolve(context, response.message);
      const tokensEntry =
        tokenUsage.size.input === 0 &&
        tokenUsage.size.output === 0 &&
        tokenUsage.size.cacheRead === 0 &&
        tokenUsage.size.cacheWrite === 0 &&
        tokenUsage.source === "estimate"
          ? null
          : {
              provider: response.providerId,
              model: response.modelId,
              size: tokenUsage.size
            };
      if (tokenUsage.source === "usage" && tokensEntry) {
        tokenStatsUpdates.push({
          provider: tokensEntry.provider,
          model: tokensEntry.model,
          size: {
            input: tokensEntry.size.input,
            output: tokensEntry.size.output,
            cacheRead: tokensEntry.size.cacheRead,
            cacheWrite: tokensEntry.size.cacheWrite
          }
        });
      }

      logger.debug(
        `Inference response received providerId=${response.providerId} modelId=${response.modelId} stopReason=${response.message.stopReason}`
      );
      context.messages.push(response.message);

      const responseText = messageExtractText(response.message);
      const toolCalls = messageExtractToolCalls(response.message);
      lastResponseHadToolCalls = toolCalls.length > 0;
      const suppressUserOutput = messageNoMessageIs(responseText);
      if (suppressUserOutput) {
        stripNoMessageTextBlocks(response.message);
        logger.debug("NO_MESSAGE detected; suppressing user output for this response");
      }
      lastResponseNoMessage = suppressUserOutput;
      const effectiveResponseText = suppressUserOutput ? null : responseText;
      const trimmedText = effectiveResponseText?.trim() ?? "";
      const hasResponseText = trimmedText.length > 0;
      finalResponseText = hasResponseText ? effectiveResponseText : null;
      lastResponseTextSent = false;
      if (hasResponseText && connector && targetId) {
        try {
          await connector.sendMessage(targetId, {
            text: effectiveResponseText,
            replyToMessageId: entry.context.messageId
          });
          eventBus.emit("agent.outgoing", {
            agentId: agent.id,
            source,
            message: { text: effectiveResponseText },
            context: entry.context
          });
          lastResponseTextSent = true;
        } catch (error) {
          logger.warn({ connector: source, error }, "Failed to send response text");
        }
      }

      logger.debug(`Extracted tool calls from response toolCallCount=${toolCalls.length}`);
      historyRecords.push({
        type: "assistant_message",
        at: Date.now(),
        text: effectiveResponseText ?? "",
        files: [],
        toolCalls,
        tokens: tokensEntry
      });
      if (toolCalls.length === 0) {
        logger.debug(`No tool calls, breaking inference loop iteration=${iteration}`);
        break;
      }

      for (const toolCall of toolCalls) {
        const argsPreview = JSON.stringify(toolCall.arguments).slice(0, 200);
        logger.debug(
          `Executing tool call toolName=${toolCall.name} toolCallId=${toolCall.id} args=${argsPreview}`
        );

        if (verbose && !suppressUserOutput && connector && targetId) {
          const argsFormatted = toolArgsFormatVerbose(toolCall.arguments);
          await connector.sendMessage(targetId, {
            text: `[tool] ${toolCall.name}(${argsFormatted})`
          });
        }

        const toolResult = await toolResolver.execute(toolCall, {
          connectorRegistry,
          fileStore,
          auth: authStore,
          logger,
          assistant,
          permissions: agent.state.permissions,
          agent,
          source,
          messageContext: entry.context,
          agentSystem,
          heartbeats
        });
        logger.debug(
          `Tool execution completed toolName=${toolCall.name} isError=${toolResult.toolMessage.isError} fileCount=${toolResult.files.length}`
        );

        if (verbose && !suppressUserOutput && connector && targetId) {
          const resultText = toolResultFormatVerbose(toolResult);
          await connector.sendMessage(targetId, {
            text: resultText
          });
        }

        context.messages.push(toolResult.toolMessage);
        historyRecords.push({
          type: "tool_result",
          at: Date.now(),
          toolCallId: toolCall.id,
          output: toolResult
        });
        if (toolResult.files.length > 0) {
          generatedFiles.push(...toolResult.files);
          logger.debug(`Tool generated files count=${toolResult.files.length}`);
        }
      }

      if (iteration === MAX_TOOL_ITERATIONS - 1) {
        logger.debug(`Tool loop limit reached iteration=${iteration}`);
        toolLoopExceeded = true;
      }
    }
    logger.debug("Inference loop completed");
  } catch (error) {
    logger.debug(`Inference loop caught error error=${String(error)}`);
    if (isContextOverflowError(error)) {
      logger.warn({ agentId: agent.id, error }, "Inference context overflow detected");
      return { responseText: finalResponseText, historyRecords, contextOverflow: true, tokenStatsUpdates };
    }
    logger.warn({ connector: source, error }, "Inference failed");
    const message =
      error instanceof Error && error.message === "No inference provider available"
        ? "No inference provider available."
        : "Inference failed.";
    logger.debug(`Sending error message to user message=${message}`);
    await notifySubagentFailure("Inference failed", error);
    if (connector && targetId) {
      await connector.sendMessage(targetId, {
        text: message,
        replyToMessageId: entry.context.messageId
      });
    }
    logger.debug("handleMessage completed with error");
    return { responseText: finalResponseText, historyRecords, tokenStatsUpdates };
  } finally {
    logger.debug("Stopping typing indicator");
    stopTyping?.();
  }

  if (!response) {
    logger.debug("No response received, returning without completion");
    return { responseText: finalResponseText, historyRecords, tokenStatsUpdates };
  }

  if (response.message.stopReason === "error" || response.message.stopReason === "aborted") {
    if (isContextOverflowError(response.message.errorMessage ?? "")) {
      logger.warn(
        { agentId: agent.id, error: response.message.errorMessage },
        "Inference context overflow detected"
      );
      return { responseText: finalResponseText, historyRecords, contextOverflow: true, tokenStatsUpdates };
    }
    const message = "Inference failed.";
    const errorDetail =
      response.message.errorMessage && response.message.errorMessage.length > 0
        ? response.message.errorMessage
        : "unknown";
    logger.warn(
      `Inference returned error response provider=${response.providerId} model=${response.modelId} stopReason=${response.message.stopReason} error=${errorDetail}`
    );
    await notifySubagentFailure("Inference failed", response.message.errorMessage);
    try {
      if (connector && targetId) {
        await connector.sendMessage(targetId, {
          text: message,
          replyToMessageId: entry.context.messageId
        });
        eventBus.emit("agent.outgoing", {
          agentId: agent.id,
          source,
          message: { text: message },
          context: entry.context
        });
      }
    } catch (error) {
      logger.warn({ connector: source, error }, "Failed to send error response");
    }
    logger.debug("handleMessage completed with error stop reason");
    return { responseText: finalResponseText, historyRecords, tokenStatsUpdates };
  }

  const responseText = messageExtractText(response.message);
  const hasResponseText = !!responseText && responseText.trim().length > 0;
  logger.debug(
    `Extracted assistant text hasText=${hasResponseText} textLength=${responseText?.length ?? 0} generatedFileCount=${generatedFiles.length}`
  );

  if (!hasResponseText && generatedFiles.length === 0) {
    if (toolLoopExceeded && lastResponseHadToolCalls) {
      const message = "Tool execution limit reached.";
      logger.debug("Tool loop exceeded, sending error message");
      await notifySubagentFailure(message);
      try {
        if (connector && targetId && !lastResponseNoMessage) {
          await connector.sendMessage(targetId, {
            text: message,
            replyToMessageId: entry.context.messageId
          });
        }
      } catch (error) {
        logger.warn({ connector: source, error }, "Failed to send tool error");
      }
    }
    logger.debug("handleMessage completed with no response text");
    return { responseText: finalResponseText, historyRecords, tokenStatsUpdates };
  }

  if (lastResponseNoMessage) {
    logger.debug("NO_MESSAGE suppressed final response delivery");
    return { responseText: finalResponseText, historyRecords, tokenStatsUpdates };
  }

  const shouldSendText = hasResponseText && !lastResponseTextSent && !lastResponseNoMessage;
  const shouldSendFiles = generatedFiles.length > 0 && !lastResponseNoMessage;
  const outgoingText =
    shouldSendText
      ? responseText
      : !hasResponseText && shouldSendFiles
        ? "Generated files."
        : null;
  logger.debug(
    `Sending response to user textLength=${outgoingText?.length ?? 0} fileCount=${generatedFiles.length} targetId=${targetId ?? "none"}`
  );
  try {
    if (connector && targetId && (outgoingText || shouldSendFiles)) {
      await connector.sendMessage(targetId, {
        text: outgoingText,
        files: shouldSendFiles ? generatedFiles : undefined,
        replyToMessageId: entry.context.messageId
      });
      logger.debug("Response sent successfully");
      eventBus.emit("agent.outgoing", {
        agentId: agent.id,
        source,
        message: {
          text: outgoingText,
          files: shouldSendFiles ? generatedFiles : undefined
        },
        context: entry.context
      });
      logger.debug("Agent outgoing event emitted");
    }
  } catch (error) {
    logger.debug(`Failed to send response error=${String(error)}`);
    logger.warn({ connector: source, error }, "Failed to send response");
  }
  logger.debug("handleMessage completed successfully");
  return { responseText: finalResponseText, historyRecords, tokenStatsUpdates };
}

// Remove NO_MESSAGE text blocks so the sentinel never re-enters future model context.
function stripNoMessageTextBlocks(message: Context["messages"][number]): void {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return;
  }
  const nextContent = message.content.filter((block) => block.type !== "text");
  if (nextContent.length !== message.content.length) {
    message.content = nextContent;
  }
}

function isContextOverflowError(error: unknown): boolean {
  const candidates = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      candidates.add(value);
    }
  };

  if (error instanceof Error) {
    add(error.message);
    add((error as { code?: unknown }).code);
    add((error as { type?: unknown }).type);
    add((error as { name?: unknown }).name);
    add((error as { status?: unknown }).status);
    add((error as { statusCode?: unknown }).statusCode);
    add((error as { error?: unknown }).error);
    add((error as { reason?: unknown }).reason);
    add((error as { details?: unknown }).details);
    add((error as { cause?: unknown }).cause);
  } else if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    add(record.message);
    add(record.code);
    add(record.type);
    add(record.name);
    add(record.status);
    add(record.statusCode);
    add(record.error);
    add(record.reason);
    add(record.details);
    add(record.cause);
  } else {
    add(error);
  }

  const patterns = [
    "context_length_exceeded",
    "context length exceeded",
    "maximum context length",
    "max context length",
    "context window",
    "context limit",
    "context too long",
    "prompt too long",
    "prompt is too long",
    "input too long",
    "input is too long",
    "input token limit",
    "maximum number of tokens",
    "max tokens",
    "exceeds the maximum context",
    "exceeds context",
    "token limit exceeded",
    "too many tokens"
  ];

  for (const value of candidates) {
    const normalized = value.toLowerCase();
    if (patterns.some((pattern) => normalized.includes(pattern))) {
      return true;
    }
  }
  return false;
}
