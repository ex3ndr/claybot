import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Context, ToolCall } from "@mariozechner/pi-ai";
import { createId } from "@paralleldrive/cuid2";
import Handlebars from "handlebars";

import { getLogger } from "../../log.js";
import { DEFAULT_SOUL_PATH, DEFAULT_USER_PATH } from "../../paths.js";
import { listActiveInferenceProviders } from "../../providers/catalog.js";
import { cuid2Is } from "../../utils/cuid2Is.js";
import { agentPromptBundledRead } from "./ops/agentPromptBundledRead.js";
import { agentPromptFilesEnsure } from "./ops/agentPromptFilesEnsure.js";
import type { MessageContext } from "@/types";
import { messageBuildUser } from "../messages/messageBuildUser.js";
import { messageFormatIncoming } from "../messages/messageFormatIncoming.js";
import { messageIsSystemText } from "../messages/messageIsSystemText.js";
import { messageBuildSystemText } from "../messages/messageBuildSystemText.js";
import { permissionBuildCron } from "../permissions/permissionBuildCron.js";
import { permissionClone } from "../permissions/permissionClone.js";
import { permissionEnsureDefaultFile } from "../permissions/permissionEnsureDefaultFile.js";
import { permissionMergeDefault } from "../permissions/permissionMergeDefault.js";
import { permissionApply } from "../permissions/permissionApply.js";
import { permissionDescribeDecision } from "../permissions/permissionDescribeDecision.js";
import { permissionFormatTag } from "../permissions/permissionFormatTag.js";
import { skillListCore } from "../skills/skillListCore.js";
import { skillListRegistered } from "../skills/skillListRegistered.js";
import { skillPromptFormat } from "../skills/skillPromptFormat.js";
import { toolListContextBuild } from "../modules/tools/toolListContextBuild.js";
import { agentDescriptorIsCron } from "./ops/agentDescriptorIsCron.js";
import { agentDescriptorIsHeartbeat } from "./ops/agentDescriptorIsHeartbeat.js";
import { agentDescriptorTargetResolve } from "./ops/agentDescriptorTargetResolve.js";
import type { AgentDescriptor } from "./ops/agentDescriptorTypes.js";
import type {
  AgentHistoryRecord,
  AgentInboxMessage,
  AgentInboxPermission,
  AgentInboxReset,
  AgentInboxRestore,
  AgentInboxResult,
  AgentMessage,
  AgentState
} from "./ops/agentTypes.js";
import { agentLoopRun } from "./ops/agentLoopRun.js";
import { AgentInbox } from "./ops/agentInbox.js";
import { agentHistoryAppend } from "./ops/agentHistoryAppend.js";
import { agentHistoryLoad } from "./ops/agentHistoryLoad.js";
import { agentStateWrite } from "./ops/agentStateWrite.js";
import { agentDescriptorWrite } from "./ops/agentDescriptorWrite.js";
import type { AgentSystem } from "./agentSystem.js";

const logger = getLogger("engine.agent");

export class Agent {
  readonly id: string;
  readonly descriptor: AgentDescriptor;
  readonly inbox: AgentInbox;
  readonly state: AgentState;
  private readonly agentSystem: AgentSystem;
  private providerId: string | null = null;
  private processing = false;
  private started = false;

  private constructor(
    id: string,
    descriptor: AgentDescriptor,
    state: AgentState,
    inbox: AgentInbox,
    agentSystem: AgentSystem
  ) {
    this.id = id;
    this.descriptor = descriptor;
    this.state = state;
    this.inbox = inbox;
    this.agentSystem = agentSystem;
  }

  /**
   * Creates a new agent and persists descriptor + state + history start.
   * Expects: agentId is a cuid2 value; descriptor is validated.
   */
  static async create(
    agentId: string,
    descriptor: AgentDescriptor,
    inbox: AgentInbox,
    agentSystem: AgentSystem
  ): Promise<Agent> {
    if (!cuid2Is(agentId)) {
      throw new Error("Agent id must be a cuid2 value.");
    }
    const now = Date.now();
    const state: AgentState = {
      context: { messages: [] },
      permissions: permissionClone(agentSystem.config.defaultPermissions),
      createdAt: now,
      updatedAt: now
    };

    const agent = new Agent(agentId, descriptor, state, inbox, agentSystem);
    await agentDescriptorWrite(agentSystem.config, agentId, descriptor);
    await agentStateWrite(agentSystem.config, agentId, state);
    await agentHistoryAppend(agentSystem.config, agentId, {
      type: "start",
      at: now
    });

    agent.agentSystem.eventBus.emit("agent.created", {
      agentId,
      source: "agent",
      context: {}
    });
    return agent;
  }

  /**
   * Rehydrates an agent from persisted descriptor + state.
   * Expects: state and descriptor already validated.
   */
  static restore(
    agentId: string,
    descriptor: AgentDescriptor,
    state: AgentState,
    inbox: AgentInbox,
    agentSystem: AgentSystem
  ): Agent {
    return new Agent(agentId, descriptor, state, inbox, agentSystem);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    logger.debug(
      `Agent loop starting agentId=${this.id} type=${this.descriptor.type}`
    );
    void this.runLoop().catch((error) => {
      this.started = false;
      this.agentSystem.markStopped(this.id, error);
      logger.warn({ agentId: this.id, error }, "Agent loop exited unexpectedly");
    });
  }

  isProcessing(): boolean {
    return this.processing;
  }

  private async runLoop(): Promise<void> {
    this.inbox.attach();
    try {
      for (;;) {
        const entry = await this.inbox.next();
        logger.debug(
          `Agent inbox item dequeued agentId=${this.id} type=${entry.item.type}`
        );
        this.processing = true;
        try {
          const result = await this.handleInboxItem(entry.item);
          entry.completion?.resolve(result);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          logger.error(
            {
              agentId: this.id,
              itemType: entry.item.type,
              errorName: failure.name,
              errorMessage: failure.message,
              errorStack: failure.stack
            },
            `Agent inbox item failed: ${failure.message}`
          );
          entry.completion?.reject(failure);
          if (entry.item.type === "message") {
            await this.sendUnexpectedError(entry.item);
          }
        } finally {
          this.processing = false;
        }
      }
    } finally {
      this.inbox.detach();
    }
  }

  private async handleInboxItem(item: AgentInboxMessage | AgentInboxReset | AgentInboxRestore | AgentInboxPermission): Promise<AgentInboxResult> {
    switch (item.type) {
      case "message": {
        const responseText = await this.handleMessage(item);
        return { type: "message", responseText };
      }
      case "reset": {
        const ok = await this.handleReset(item);
        return { type: "reset", ok };
      }
      case "restore": {
        const ok = await this.handleRestore(item);
        return { type: "restore", ok };
      }
      case "permission": {
        const ok = await this.handlePermission(item);
        return { type: "permission", ok };
      }
      default:
        return { type: "restore", ok: false };
    }
  }

  private async sendUnexpectedError(item: AgentInboxMessage): Promise<void> {
    if (this.descriptor.type !== "user") {
      return;
    }
    const connector = this.agentSystem.connectorRegistry.get(this.descriptor.connector);
    if (!connector?.capabilities.sendText) {
      return;
    }
    try {
      await connector.sendMessage(this.descriptor.channelId, {
        text: "Unexpected error",
        replyToMessageId: item.context.messageId
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        { agentId: this.id, error: failure },
        "Failed to send unexpected error message"
      );
    }
  }

  private async handleMessage(item: AgentInboxMessage): Promise<string | null> {
    const receivedAt = Date.now();
    const messageId = createId();
    const context = { ...item.context };
    const entry: AgentMessage = {
      id: messageId,
      message: messageFormatIncoming(item.message, context, new Date(receivedAt)),
      context,
      receivedAt
    };
    const source =
      this.descriptor.type === "user" ? this.descriptor.connector : this.descriptor.type;
    logger.debug(
      `handleMessage start agentId=${this.id} source=${source} textLength=${entry.message.text?.length ?? 0} fileCount=${entry.message.files?.length ?? 0}`
    );

    this.state.updatedAt = receivedAt;

    const rawText = entry.message.rawText ?? entry.message.text ?? "";
    const files = toFileReferences(entry.message.files ?? []);
    if (!messageIsSystemText(rawText)) {
      await agentHistoryAppend(this.agentSystem.config, this.id, {
        type: "user_message",
        at: receivedAt,
        text: rawText,
        files
      });
    }

    const agentContext = this.state.context;
    const providers = listActiveInferenceProviders(this.agentSystem.config.settings);
    const providerId = this.resolveAgentProvider(providers);

    const connector = this.agentSystem.connectorRegistry.get(source);
    const connectorCapabilities = connector?.capabilities ?? null;
    const fileSendModes = connectorCapabilities?.sendFiles?.modes ?? [];
    const cronTasks = await this.agentSystem.crons.listTasks();
    const cronTaskIds = cronTasks.map((task) => task.id);
    const descriptor = this.descriptor;
    const cronTask = agentDescriptorIsCron(descriptor)
      ? cronTasks.find((task) => task.taskUid === descriptor.id) ?? null
      : null;
    const descriptorContext =
      descriptor.type === "user"
        ? {
            connector: descriptor.connector,
            channelId: descriptor.channelId,
            userId: descriptor.userId
          }
        : { connector: source };
    const pluginManager = this.agentSystem.pluginManager;
    logger.debug(`handleMessage loading plugin prompts agentId=${this.id}`);
    const pluginPrompts = await pluginManager.getSystemPrompts();
    const pluginPrompt = pluginPrompts.length > 0 ? pluginPrompts.join("\n\n") : "";
    logger.debug(`handleMessage loading core skills agentId=${this.id}`);
    const coreSkills = await skillListCore();
    logger.debug(`handleMessage loading plugin skills agentId=${this.id}`);
    const pluginSkills = await skillListRegistered(pluginManager.listRegisteredSkills());
    const skills = [...coreSkills, ...pluginSkills];
    const skillsPrompt = skillPromptFormat(skills);
    const agentKind = this.resolveAgentKind();
    const allowCronTools = agentDescriptorIsCron(this.descriptor);

    const defaultPermissions = this.agentSystem.config.defaultPermissions;
    if (cronTask?.filesPath) {
      this.state.permissions = permissionBuildCron(defaultPermissions, cronTask.filesPath);
    } else if (agentDescriptorIsHeartbeat(this.descriptor)) {
      this.state.permissions = permissionMergeDefault(this.state.permissions, defaultPermissions);
      permissionEnsureDefaultFile(this.state.permissions, defaultPermissions);
    }

    logger.debug(`handleMessage ensuring prompt files agentId=${this.id}`);
    await agentPromptFilesEnsure();

    const providerSettings = providerId
      ? providers.find((provider) => provider.id === providerId)
      : providers[0];

    logger.debug(`handleMessage building system prompt agentId=${this.id}`);
    const systemPrompt = await this.buildSystemPrompt({
      provider: providerSettings?.id,
      model: providerSettings?.model,
      workspace: this.state.permissions.workingDir,
      writeDirs: this.state.permissions.writeDirs,
      web: this.state.permissions.web,
      connector: descriptorContext.connector,
      canSendFiles: fileSendModes.length > 0,
      fileSendModes: fileSendModes.length > 0 ? fileSendModes.join(", ") : "",
      messageFormatPrompt: connectorCapabilities?.messageFormatPrompt ?? "",
      channelId: descriptorContext.channelId,
      userId: descriptorContext.userId,
      cronTaskId: cronTask?.id,
      cronTaskName: cronTask?.name,
      cronMemoryPath: cronTask?.memoryPath,
      cronFilesPath: cronTask?.filesPath,
      cronTaskIds: cronTaskIds.length > 0 ? cronTaskIds.join(", ") : "",
      soulPath: DEFAULT_SOUL_PATH,
      userPath: DEFAULT_USER_PATH,
      pluginPrompt,
      skillsPrompt,
      agentKind,
      parentAgentId: this.descriptor.type === "subagent"
        ? this.descriptor.parentAgentId ?? ""
        : "",
      configDir: this.agentSystem.config.configDir
    });

    const contextForRun: Context = {
      ...agentContext,
      tools: this.listContextTools(source, {
        agentKind,
        allowCronTools
      }),
      systemPrompt
    };

    logger.debug(`handleMessage building user message agentId=${this.id}`);
    const userMessage = await messageBuildUser(entry);
    contextForRun.messages.push(userMessage);

    const providersForAgent = providerId
      ? providers.filter((provider) => provider.id === providerId)
      : [];

    logger.debug(`handleMessage invoking inference loop agentId=${this.id}`);
    const result = await agentLoopRun({
      entry,
      agent: this,
      source,
      context: contextForRun,
      connector,
      connectorRegistry: this.agentSystem.connectorRegistry,
      inferenceRouter: this.agentSystem.inferenceRouter,
      toolResolver: this.agentSystem.toolResolver,
      fileStore: this.agentSystem.fileStore,
      authStore: this.agentSystem.authStore,
      eventBus: this.agentSystem.eventBus,
      assistant: this.agentSystem.config.settings.assistant ?? null,
      agentSystem: this.agentSystem,
      heartbeats: this.agentSystem.heartbeats,
      providersForAgent,
      verbose: this.agentSystem.config.verbose,
      logger,
      notifySubagentFailure: (reason, error) => this.notifySubagentFailure(reason, error)
    });

    for (const record of result.historyRecords) {
      await agentHistoryAppend(this.agentSystem.config, this.id, record);
    }

    this.state.context = { messages: contextForRun.messages };
    this.state.updatedAt = Date.now();
    await agentStateWrite(this.agentSystem.config, this.id, this.state);

    return result.responseText ?? null;
  }

  private async handleReset(_item: AgentInboxReset): Promise<boolean> {
    const now = Date.now();
    this.state.context = { messages: [] };
    this.state.updatedAt = now;
    await agentHistoryAppend(this.agentSystem.config, this.id, {
      type: "reset",
      at: now
    });
    await agentStateWrite(this.agentSystem.config, this.id, this.state);
    this.agentSystem.eventBus.emit("agent.reset", {
      agentId: this.id,
      context: {}
    });
    return true;
  }

  private async handleRestore(_item: AgentInboxRestore): Promise<boolean> {
    const history = await agentHistoryLoad(this.agentSystem.config, this.id);
    const messages = await this.buildHistoryContext(history);
    this.state.context = { messages };
    this.state.updatedAt = Date.now();
    await agentStateWrite(this.agentSystem.config, this.id, this.state);
    this.agentSystem.eventBus.emit("agent.restored", { agentId: this.id });
    return true;
  }

  private async handlePermission(item: AgentInboxPermission): Promise<boolean> {
    const context = item.context;
    const decision = item.decision;
    const target = agentDescriptorTargetResolve(this.descriptor);
    if (!target) {
      logger.error(
        { agentId: this.id },
        "Permission decision missing user target"
      );
      return false;
    }
    const source = target.connector;
    const connector = this.agentSystem.connectorRegistry.get(target.connector);
    const permissionTag = permissionFormatTag(decision.access);
    const permissionLabel = permissionDescribeDecision(decision.access);

    if (!decision.approved) {
      logger.info(
        { source, permission: permissionTag, agentId: this.id },
        "Permission denied"
      );
    }

    if (decision.approved && (decision.access.kind === "read" || decision.access.kind === "write")) {
      if (!path.isAbsolute(decision.access.path)) {
        logger.warn({ agentId: this.id, permission: permissionTag }, "Permission path not absolute");
        if (connector) {
          await connector.sendMessage(target.targetId, {
            text: `Permission ignored (path must be absolute): ${permissionLabel}.`,
            replyToMessageId: context.messageId
          });
        }
        return false;
      }
    }

    if (decision.approved) {
      permissionApply(this.state.permissions, decision);
      await agentStateWrite(this.agentSystem.config, this.id, this.state);
      this.agentSystem.eventBus.emit("permission.granted", {
        agentId: this.id,
        source,
        decision
      });
    }

    const resumeText = decision.approved
      ? `Permission granted for ${permissionLabel}. Please continue with the previous request.`
      : `Permission denied for ${permissionLabel}. Please continue without that permission.`;
    const resumeMessage: AgentInboxMessage = {
      type: "message",
      message: { text: resumeText, rawText: resumeText },
      context: { ...context }
    };
    await this.handleMessage(resumeMessage);
    return true;
  }

  /**
   * Notifies a parent agent when a subagent fails.
   * Expects: parent agent exists.
   */
  async notifySubagentFailure(reason: string, error?: unknown): Promise<void> {
    if (this.descriptor.type !== "subagent") {
      return;
    }
    const parentAgentId = this.descriptor.parentAgentId ?? null;
    if (!parentAgentId) {
      logger.warn({ agentId: this.id }, "Subagent missing parent agent");
      return;
    }
    const name = this.descriptor.name ?? "subagent";
    const errorText = error instanceof Error ? error.message : error ? String(error) : "";
    const detail = errorText ? `${reason} (${errorText})` : reason;
    try {
      const text = messageBuildSystemText(
        `Subagent ${name} (${this.id}) failed: ${detail}.`,
        "background"
      );
      await this.agentSystem.post(
        { agentId: parentAgentId },
        { type: "message", message: { text }, context: {} }
      );
    } catch (sendError) {
      logger.warn(
        { agentId: this.id, parentAgentId, error: sendError },
        "Subagent failure notification failed"
      );
    }
  }

  /**
   * Resolves the cron task id for this agent when available.
   * Expects: cron task uid maps to a task on disk.
   */
  async resolveCronTaskId(): Promise<string | null> {
    const descriptor = this.descriptor;
    if (!agentDescriptorIsCron(descriptor)) {
      return null;
    }
    const tasks = await this.agentSystem.crons.listTasks();
    const task = tasks.find((entry) => entry.taskUid === descriptor.id) ?? null;
    return task?.id ?? null;
  }

  private listContextTools(
    source?: string,
    options?: { agentKind?: "background" | "foreground"; allowCronTools?: boolean }
  ) {
    return toolListContextBuild({
      tools: this.agentSystem.toolResolver.listTools(),
      source,
      agentKind: options?.agentKind,
      allowCronTools: options?.allowCronTools,
      connectorRegistry: this.agentSystem.connectorRegistry,
      imageRegistry: this.agentSystem.imageRegistry
    });
  }

  private resolveAgentKind(): "background" | "foreground" {
    if (this.descriptor.type === "user") {
      return "foreground";
    }
    return "background";
  }

  private resolveAgentProvider(
    providers: ReturnType<typeof listActiveInferenceProviders>
  ): string | null {
    const activeIds = new Set(providers.map((provider) => provider.id));

    let providerId = this.providerId ?? null;
    if (!providerId || !activeIds.has(providerId)) {
      providerId = providers[0]?.id ?? null;
    }

    if (providerId && this.providerId !== providerId) {
      this.providerId = providerId;
    }

    return providerId;
  }

  private async buildHistoryContext(
    records: AgentHistoryRecord[]
  ): Promise<Context["messages"]> {
    const messages: Context["messages"] = [];
    for (const record of records) {
      if (record.type === "user_message") {
        const context: MessageContext = {};
        const message = messageFormatIncoming(
          {
            text: record.text,
            files: record.files.map((file) => ({ ...file }))
          },
          context,
          new Date(record.at)
        );
        const userEntry: AgentMessage = {
          id: createId(),
          message,
          context,
          receivedAt: record.at
        };
        messages.push(await messageBuildUser(userEntry));
      }
      if (record.type === "assistant_message") {
        const content: Array<{ type: "text"; text: string } | ToolCall> = [];
        if (record.text.length > 0) {
          content.push({ type: "text", text: record.text });
        }
        for (const toolCall of record.toolCalls) {
          content.push(toolCall);
        }
        messages.push({
          role: "assistant",
          content,
          api: "history",
          provider: "history",
          model: "history",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0
            }
          },
          stopReason: "stop",
          timestamp: record.at
        });
      }
      if (record.type === "tool_result") {
        messages.push(record.output.toolMessage);
      }
    }
    return messages;
  }

  /**
   * Builds the system prompt text for the current agent.
   * Expects: prompt templates exist under engine/prompts.
   */
  private async buildSystemPrompt(
    context: AgentSystemPromptContext = {}
  ): Promise<string> {
    const soulPath = context.soulPath ?? DEFAULT_SOUL_PATH;
    const userPath = context.userPath ?? DEFAULT_USER_PATH;
    logger.debug(`buildSystemPrompt reading soul prompt path=${soulPath}`);
    const soul = await promptFileRead(soulPath, "SOUL.md");
    logger.debug(`buildSystemPrompt reading user prompt path=${userPath}`);
    const user = await promptFileRead(userPath, "USER.md");
    const templateName =
      context.agentKind === "background" ? "SYSTEM_BACKGROUND.md" : "SYSTEM.md";
    logger.debug(`buildSystemPrompt reading system template name=${templateName}`);
    const systemTemplate = await agentPromptBundledRead(templateName);
    logger.debug("buildSystemPrompt reading permissions template");
    const permissions = (await agentPromptBundledRead("PERMISSIONS.md")).trim();
    const additionalWriteDirs = resolveAdditionalWriteDirs(
      context.writeDirs ?? [],
      context.workspace ?? "",
      soulPath,
      userPath
    );

    const isForeground = context.agentKind !== "background";
    const skillsPath =
      context.skillsPath ?? (context.configDir ? `${context.configDir}/skills` : "");

    logger.debug("buildSystemPrompt compiling template");
    const template = Handlebars.compile(systemTemplate);
    logger.debug("buildSystemPrompt rendering template");
    const rendered = template({
      date: new Date().toISOString().split("T")[0],
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      model: context.model ?? "unknown",
      provider: context.provider ?? "unknown",
      workspace: context.workspace ?? "unknown",
      web: context.web ?? false,
      connector: context.connector ?? "unknown",
      canSendFiles: context.canSendFiles ?? false,
      fileSendModes: context.fileSendModes ?? "",
      messageFormatPrompt: context.messageFormatPrompt ?? "",
      channelId: context.channelId ?? "unknown",
      userId: context.userId ?? "unknown",
      cronTaskId: context.cronTaskId ?? "",
      cronTaskName: context.cronTaskName ?? "",
      cronMemoryPath: context.cronMemoryPath ?? "",
      cronFilesPath: context.cronFilesPath ?? "",
      cronTaskIds: context.cronTaskIds ?? "",
      soulPath,
      userPath,
      pluginPrompt: context.pluginPrompt ?? "",
      skillsPrompt: context.skillsPrompt ?? "",
      parentAgentId: context.parentAgentId ?? "",
      configDir: context.configDir ?? "",
      skillsPath,
      isForeground,
      soul,
      user,
      permissions,
      additionalWriteDirs
    });

    return rendered.trim();
  }
}

type AgentSystemPromptContext = {
  model?: string;
  provider?: string;
  workspace?: string;
  writeDirs?: string[];
  web?: boolean;
  connector?: string;
  canSendFiles?: boolean;
  fileSendModes?: string;
  messageFormatPrompt?: string;
  channelId?: string;
  userId?: string;
  cronTaskId?: string;
  cronTaskName?: string;
  cronMemoryPath?: string;
  cronFilesPath?: string;
  cronTaskIds?: string;
  soulPath?: string;
  userPath?: string;
  pluginPrompt?: string;
  skillsPrompt?: string;
  agentKind?: "background" | "foreground";
  parentAgentId?: string;
  configDir?: string;
  skillsPath?: string;
};

function resolveAdditionalWriteDirs(
  writeDirs: string[],
  workspace: string,
  soulPath: string,
  userPath: string
): string[] {
  const excluded = new Set(
    [workspace, soulPath, userPath]
      .filter((entry) => entry && entry.trim().length > 0)
      .map((entry) => path.resolve(entry))
  );
  const filtered = writeDirs
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => path.resolve(entry))
    .filter((entry) => !excluded.has(entry));
  return Array.from(new Set(filtered)).sort();
}

async function promptFileRead(filePath: string, fallbackPrompt: string): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  try {
    const content = await fs.readFile(resolvedPath, "utf8");
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const defaultContent = await agentPromptBundledRead(fallbackPrompt);
  return defaultContent.trim();
}

function toFileReferences(files: Array<{ id: string; name: string; path: string; mimeType: string; size: number }>): Array<{ id: string; name: string; path: string; mimeType: string; size: number }> {
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    path: file.path,
    mimeType: file.mimeType,
    size: file.size
  }));
}
