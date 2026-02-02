import { promises as fs } from "node:fs";

/**
 * Reads a bundled prompt template from engine/prompts.
 * Expects: filename matches a bundled prompt file.
 */
export async function agentPromptBundledRead(filename: string): Promise<string> {
  const promptPath = new URL(`../../../prompts/${filename}`, import.meta.url);
  return fs.readFile(promptPath, "utf8");
}
