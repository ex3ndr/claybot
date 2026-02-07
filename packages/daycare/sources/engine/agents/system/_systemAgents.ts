import type { SystemAgentDefinition } from "./systemAgentTypes.js";

/**
 * Hardcoded list of built-in system agents.
 * Expects: tags stay lowercase english words.
 */
export const SYSTEM_AGENTS: readonly SystemAgentDefinition[] = [
  {
    tag: "heartbeat",
    promptFile: "HEARTBEAT.md",
    replaceSystemPrompt: false
  },
  {
    tag: "architect",
    promptFile: "ARCHITECT.md",
    replaceSystemPrompt: true
  }
];
