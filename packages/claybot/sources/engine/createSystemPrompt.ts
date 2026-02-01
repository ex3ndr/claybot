import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Handlebars from "handlebars";

import { DEFAULT_SOUL_PATH, DEFAULT_USER_PATH } from "../paths.js";

export type SystemPromptContext = {
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
  channelType?: string;
  channelIsPrivate?: boolean | null;
  userId?: string;
  userFirstName?: string;
  userLastName?: string;
  username?: string;
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
  parentSessionId?: string;
  configDir?: string;
  skillsPath?: string;
};

export async function createSystemPrompt(context: SystemPromptContext = {}): Promise<string> {
  const soul = await readSoul();
  const user = await readUser();
  const systemTemplate = await readSystemTemplate(
    context.agentKind === "background" ? "SYSTEM_BACKGROUND.md" : "SYSTEM.md"
  );
  const permissions = await readPermissions();
  const additionalWriteDirs = resolveAdditionalWriteDirs(
    context.writeDirs ?? [],
    context.workspace ?? "",
    context.soulPath ?? DEFAULT_SOUL_PATH,
    context.userPath ?? DEFAULT_USER_PATH
  );

  const isForeground = context.agentKind !== "background";
  const skillsPath = context.skillsPath ?? (context.configDir ? `${context.configDir}/skills` : "");

  const template = Handlebars.compile(systemTemplate);
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
    channelType: context.channelType ?? "",
    channelIsPrivate: context.channelIsPrivate ?? null,
    userId: context.userId ?? "unknown",
    userFirstName: context.userFirstName ?? "",
    userLastName: context.userLastName ?? "",
    username: context.username ?? "",
    cronTaskId: context.cronTaskId ?? "",
    cronTaskName: context.cronTaskName ?? "",
    cronMemoryPath: context.cronMemoryPath ?? "",
    cronFilesPath: context.cronFilesPath ?? "",
    cronTaskIds: context.cronTaskIds ?? "",
    soulPath: context.soulPath ?? DEFAULT_SOUL_PATH,
    userPath: context.userPath ?? DEFAULT_USER_PATH,
    pluginPrompt: context.pluginPrompt ?? "",
    skillsPrompt: context.skillsPrompt ?? "",
    parentSessionId: context.parentSessionId ?? "",
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

async function readSoul(): Promise<string> {
  return readPromptFile(DEFAULT_SOUL_PATH, "SOUL.md");
}

async function readSystemTemplate(filename: string): Promise<string> {
  return readBundledPrompt(filename);
}

async function readPermissions(): Promise<string> {
  const permissions = await readBundledPrompt("PERMISSIONS.md");
  return permissions.trim();
}

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

async function readUser(): Promise<string> {
  return readPromptFile(DEFAULT_USER_PATH, "USER.md");
}

async function readPromptFile(filePath: string, fallbackPrompt: string): Promise<string> {
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

  const defaultContent = await readBundledPrompt(fallbackPrompt);
  return defaultContent.trim();
}

async function readBundledPrompt(filename: string): Promise<string> {
  const promptPath = new URL(`../prompts/${filename}`, import.meta.url);
  return fs.readFile(promptPath, "utf8");
}

export async function assumeWorkspace(): Promise<void> {
  await ensurePromptFile(DEFAULT_SOUL_PATH, "SOUL.md");
  await ensurePromptFile(DEFAULT_USER_PATH, "USER.md");
}

async function ensurePromptFile(filePath: string, bundledName: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  try {
    await fs.access(resolvedPath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const content = await readBundledPrompt(bundledName);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, "utf8");
}
