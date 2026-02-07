const SYSTEM_AGENT_TAG_PATTERN = /^[a-z]+$/;

/**
 * Validates system-agent tags.
 * Expects: lowercase english letters only.
 */
export function systemAgentTagIs(tag: string): boolean {
  return SYSTEM_AGENT_TAG_PATTERN.test(tag.trim());
}
