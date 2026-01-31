import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Handlebars from "handlebars";

import { DEFAULT_SOUL_PATH } from "../paths.js";

export type SystemPromptContext = {
  model?: string;
  provider?: string;
  workspace?: string;
  connector?: string;
  canSendFiles?: boolean;
  fileSendModes?: string;
  channelId?: string;
  channelType?: string;
  channelIsPrivate?: boolean | null;
  userId?: string | null;
  userFirstName?: string;
  userLastName?: string;
  username?: string;
  cronTaskId?: string;
  cronTaskName?: string;
  cronMemoryPath?: string;
  cronFilesPath?: string;
};

export async function createSystemPrompt(context: SystemPromptContext = {}): Promise<string> {
  const soul = await readSoul();
  const systemTemplate = await readSystemTemplate();

  const template = Handlebars.compile(systemTemplate);
  const rendered = template({
    date: new Date().toISOString().split("T")[0],
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    model: context.model ?? "unknown",
    provider: context.provider ?? "unknown",
    workspace: context.workspace ?? "unknown",
    connector: context.connector ?? "unknown",
    canSendFiles: context.canSendFiles ?? false,
    fileSendModes: context.fileSendModes ?? "",
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
    soul
  });

  return rendered.trim();
}

async function readSoul(): Promise<string> {
  const resolvedPath = path.resolve(DEFAULT_SOUL_PATH);
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

  // File missing or empty - create from bundled default
  const defaultContent = await readBundledPrompt("SOUL.md");
  const dir = path.dirname(resolvedPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(resolvedPath, defaultContent, "utf8");
  return defaultContent.trim();
}

async function readSystemTemplate(): Promise<string> {
  return readBundledPrompt("SYSTEM.md");
}

async function readBundledPrompt(filename: string): Promise<string> {
  const promptPath = new URL(`../prompts/${filename}`, import.meta.url);
  return fs.readFile(promptPath, "utf8");
}
