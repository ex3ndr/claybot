import { agentPromptBundledRead } from "../ops/agentPromptBundledRead.js";
import { SYSTEM_AGENTS } from "./_systemAgents.js";
import { systemAgentTagIs } from "./systemAgentTagIs.js";
import type { SystemAgentPrompt } from "./systemAgentTypes.js";

const systemAgentPromptCache = new Map<string, SystemAgentPrompt>();

/**
 * Resolves a built-in system-agent prompt by tag.
 * Expects: tags are lowercase english words.
 */
export async function systemAgentPromptResolve(tag: string): Promise<SystemAgentPrompt | null> {
  const normalized = tag.trim();
  if (!systemAgentTagIs(normalized)) {
    return null;
  }

  const cached = systemAgentPromptCache.get(normalized);
  if (cached) {
    return cached;
  }

  const definition = SYSTEM_AGENTS.find((entry) => entry.tag === normalized);
  if (!definition) {
    return null;
  }

  const systemPrompt = (await agentPromptBundledRead(definition.promptFile)).trim();
  if (!systemPrompt) {
    throw new Error(`System agent prompt is empty: ${definition.promptFile}`);
  }

  const resolved: SystemAgentPrompt = {
    tag: definition.tag,
    systemPrompt,
    replaceSystemPrompt: definition.replaceSystemPrompt
  };
  systemAgentPromptCache.set(normalized, resolved);
  return resolved;
}
