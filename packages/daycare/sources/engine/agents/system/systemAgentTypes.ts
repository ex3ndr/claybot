/**
 * Hardcoded system-agent definition.
 */
export type SystemAgentDefinition = {
  tag: string;
  promptFile: string;
  replaceSystemPrompt: boolean;
};

/**
 * Resolved system-agent prompt settings.
 */
export type SystemAgentPrompt = {
  tag: string;
  systemPrompt: string;
  replaceSystemPrompt: boolean;
};
