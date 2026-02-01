import type { Context } from "@mariozechner/pi-ai";
import type { Logger } from "pino";

import type { FileStore } from "../../files/store.js";
import type { FileReference } from "../../files/types.js";
import type { AuthStore } from "../../auth/store.js";
import type { AssistantSettings, ProviderSettings } from "../../settings.js";
import type { Connector } from "../connectors/types.js";
import type { ConnectorRegistry, ToolResolver } from "../modules.js";
import type { InferenceRouter } from "../inference/router.js";
import type { Session } from "../sessions/session.js";
import type { SessionStore } from "../sessions/store.js";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import type { SessionMessage } from "../sessions/types.js";
import { messageExtractText } from "../messages/messageExtractText.js";
import { messageExtractToolCalls } from "../messages/messageExtractToolCalls.js";
import { sessionRecordOutgoing } from "../sessions/sessionRecordOutgoing.js";
import { sessionRecordState } from "../sessions/sessionRecordState.js";
import { toolArgsFormatVerbose } from "../tools/toolArgsFormatVerbose.js";
import { toolResultFormatVerbose } from "../tools/toolResultFormatVerbose.js";
import type { AgentRuntime } from "../tools/types.js";
import type { EngineEventBus } from "../ipc/events.js";

const MAX_TOOL_ITERATIONS = 5;

type AgentLoopRunOptions = {
  entry: SessionMessage;
  session: Session<SessionState>;
  source: string;
  context: Context;
  connector: Connector | null;
  connectorRegistry: ConnectorRegistry;
  inferenceRouter: InferenceRouter;
  toolResolver: ToolResolver;
  fileStore: FileStore;
  authStore: AuthStore;
  sessionStore: SessionStore<SessionState>;
  eventBus: EngineEventBus;
  assistant: AssistantSettings | null;
  agentRuntime: AgentRuntime;
  providersForSession: ProviderSettings[];
  verbose: boolean;
  logger: Logger;
  notifySubagentFailure: (reason: string, error?: unknown) => Promise<void>;
};

/**
 * Runs the agent inference loop and handles tool execution + response delivery.
 * Expects: context already includes the user message and system prompt.
 */
export async function agentLoopRun(options: AgentLoopRunOptions): Promise<void> {
  const {
    entry,
    session,
    source,
    context,
    connector,
    connectorRegistry,
    inferenceRouter,
    toolResolver,
    fileStore,
    authStore,
    sessionStore,
    eventBus,
    assistant,
    agentRuntime,
    providersForSession,
    verbose,
    logger,
    notifySubagentFailure
  } = options;

  let response: Awaited<ReturnType<InferenceRouter["complete"]>> | null = null;
  let toolLoopExceeded = false;
  const generatedFiles: FileReference[] = [];
  let lastResponseTextSent = false;
  logger.debug(`Starting typing indicator channelId=${entry.context.channelId}`);
  const stopTyping = connector?.startTyping?.(entry.context.channelId);

  try {
    logger.debug(`Starting inference loop maxIterations=${MAX_TOOL_ITERATIONS}`);
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      logger.debug(
        `Inference loop iteration=${iteration} sessionId=${session.id} messageCount=${context.messages.length}`
      );
      try {
        await sessionStore.recordModelContext(session, source, context, {
          messageId: entry.id,
          iteration
        });
      } catch (error) {
        logger.warn(
          { sessionId: session.id, source, messageId: entry.id, error },
          "Session persistence failed"
        );
      }
      response = await inferenceRouter.complete(context, session.id, {
        providersOverride: providersForSession,
        onAttempt: (providerId, modelId) => {
          logger.debug(
            `Inference attempt starting providerId=${providerId} modelId=${modelId} sessionId=${session.id}`
          );
          logger.info(
            { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId },
            "Inference started"
          );
        },
        onFallback: (providerId, error) => {
          logger.debug(
            `Inference falling back to next provider providerId=${providerId} error=${String(error)}`
          );
          logger.warn(
            { sessionId: session.id, messageId: entry.id, provider: providerId, error },
            "Inference fallback"
          );
        },
        onSuccess: (providerId, modelId, message) => {
          logger.debug(
            `Inference succeeded providerId=${providerId} modelId=${modelId} stopReason=${message.stopReason} inputTokens=${message.usage?.input} outputTokens=${message.usage?.output}`
          );
          logger.info(
            {
              sessionId: session.id,
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
            { sessionId: session.id, messageId: entry.id, provider: providerId, error },
            "Inference failed"
          );
        }
      });

      logger.debug(
        `Inference response received providerId=${response.providerId} modelId=${response.modelId} stopReason=${response.message.stopReason}`
      );
      context.messages.push(response.message);

      const responseText = messageExtractText(response.message);
      const hasResponseText = !!responseText && responseText.trim().length > 0;
      lastResponseTextSent = false;
      if (hasResponseText && connector) {
        try {
          await connector.sendMessage(entry.context.channelId, {
            text: responseText,
            replyToMessageId: entry.context.messageId
          });
          await sessionRecordOutgoing({
            sessionStore,
            session,
            source,
            context: entry.context,
            text: responseText,
            origin: "model",
            logger
          });
          eventBus.emit("session.outgoing", {
            sessionId: session.id,
            source,
            message: { text: responseText },
            context: entry.context
          });
          lastResponseTextSent = true;
        } catch (error) {
          logger.warn({ connector: source, error }, "Failed to send response text");
        }
      }

      const toolCalls = messageExtractToolCalls(response.message);
      logger.debug(`Extracted tool calls from response toolCallCount=${toolCalls.length}`);
      if (toolCalls.length === 0) {
        logger.debug(`No tool calls, breaking inference loop iteration=${iteration}`);
        break;
      }

      for (const toolCall of toolCalls) {
        const argsPreview = JSON.stringify(toolCall.arguments).slice(0, 200);
        logger.debug(
          `Executing tool call toolName=${toolCall.name} toolCallId=${toolCall.id} args=${argsPreview}`
        );

        if (verbose && connector) {
          const argsFormatted = toolArgsFormatVerbose(toolCall.arguments);
          await connector.sendMessage(entry.context.channelId, {
            text: `[tool] ${toolCall.name}(${argsFormatted})`
          });
        }

        const toolResult = await toolResolver.execute(toolCall, {
          connectorRegistry,
          fileStore,
          auth: authStore,
          logger,
          assistant,
          permissions: session.context.state.permissions,
          session,
          source,
          messageContext: entry.context,
          agentRuntime
        });
        logger.debug(
          `Tool execution completed toolName=${toolCall.name} isError=${toolResult.toolMessage.isError} fileCount=${toolResult.files?.length ?? 0}`
        );

        if (verbose && connector) {
          const resultText = toolResultFormatVerbose(toolResult);
          await connector.sendMessage(entry.context.channelId, {
            text: resultText
          });
        }

        context.messages.push(toolResult.toolMessage);
        if (toolResult.files?.length) {
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
    logger.warn({ connector: source, error }, "Inference failed");
    const message =
      error instanceof Error && error.message === "No inference provider available"
        ? "No inference provider available."
        : "Inference failed.";
    logger.debug(`Sending error message to user message=${message}`);
    await notifySubagentFailure("Inference failed", error);
    if (connector) {
      await connector.sendMessage(entry.context.channelId, {
        text: message,
        replyToMessageId: entry.context.messageId
      });
      await sessionRecordOutgoing({
        sessionStore,
        session,
        source,
        context: entry.context,
        text: message,
        origin: "system",
        logger
      });
    }
    await sessionRecordState({
      sessionStore,
      session,
      source,
      logger
    });
    logger.debug("handleMessage completed with error");
    return;
  } finally {
    logger.debug("Stopping typing indicator");
    stopTyping?.();
  }

  if (!response) {
    logger.debug("No response received, recording session state only");
    await sessionRecordState({
      sessionStore,
      session,
      source,
      logger
    });
    return;
  }

  if (response.message.stopReason === "error" || response.message.stopReason === "aborted") {
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
      if (connector) {
        await connector.sendMessage(entry.context.channelId, {
          text: message,
          replyToMessageId: entry.context.messageId
        });
        await sessionRecordOutgoing({
          sessionStore,
          session,
          source,
          context: entry.context,
          text: message,
          origin: "system",
          logger
        });
        eventBus.emit("session.outgoing", {
          sessionId: session.id,
          source,
          message: { text: message },
          context: entry.context
        });
      }
    } catch (error) {
      logger.warn({ connector: source, error }, "Failed to send error response");
    } finally {
      await sessionRecordState({
        sessionStore,
        session,
        source,
        logger
      });
      logger.debug("handleMessage completed with error stop reason");
    }
    return;
  }

  const responseText = messageExtractText(response.message);
  const hasResponseText = !!responseText && responseText.trim().length > 0;
  logger.debug(
    `Extracted assistant text hasText=${hasResponseText} textLength=${responseText?.length ?? 0} generatedFileCount=${generatedFiles.length}`
  );

  if (!hasResponseText && generatedFiles.length === 0) {
    if (toolLoopExceeded) {
      const message = "Tool execution limit reached.";
      logger.debug("Tool loop exceeded, sending error message");
      await notifySubagentFailure(message);
      try {
        if (connector) {
          await connector.sendMessage(entry.context.channelId, {
            text: message,
            replyToMessageId: entry.context.messageId
          });
          await sessionRecordOutgoing({
            sessionStore,
            session,
            source,
            context: entry.context,
            text: message,
            origin: "system",
            logger
          });
        }
      } catch (error) {
        logger.warn({ connector: source, error }, "Failed to send tool error");
      }
    }
    await sessionRecordState({
      sessionStore,
      session,
      source,
      logger
    });
    logger.debug("handleMessage completed with no response text");
    return;
  }

  const shouldSendText = hasResponseText && !lastResponseTextSent;
  const shouldSendFiles = generatedFiles.length > 0;
  const outgoingText =
    shouldSendText
      ? responseText
      : !hasResponseText && shouldSendFiles
        ? "Generated files."
        : null;
  logger.debug(
    `Sending response to user textLength=${outgoingText?.length ?? 0} fileCount=${generatedFiles.length} channelId=${entry.context.channelId}`
  );
  try {
    if (connector && (outgoingText || shouldSendFiles)) {
      await connector.sendMessage(entry.context.channelId, {
        text: outgoingText,
        files: shouldSendFiles ? generatedFiles : undefined,
        replyToMessageId: entry.context.messageId
      });
      logger.debug("Response sent successfully");
      await sessionRecordOutgoing({
        sessionStore,
        session,
        source,
        context: entry.context,
        text: outgoingText,
        files: shouldSendFiles ? generatedFiles : undefined,
        origin: "model",
        logger
      });
      eventBus.emit("session.outgoing", {
        sessionId: session.id,
        source,
        message: {
          text: outgoingText,
          files: shouldSendFiles ? generatedFiles : undefined
        },
        context: entry.context
      });
      logger.debug("Session outgoing event emitted");
    }
  } catch (error) {
    logger.debug(`Failed to send response error=${String(error)}`);
    logger.warn({ connector: source, error }, "Failed to send response");
  } finally {
    await sessionRecordState({
      sessionStore,
      session,
      source,
      logger
    });
    logger.debug("handleMessage completed successfully");
  }
}
