import { skillSort } from "./skillSort.js";
import type { AgentSkill } from "./skillTypes.js";
import { xmlEscape } from "../../util/xmlEscape.js";

/**
 * Formats available skills into an XML prompt segment for the system prompt.
 *
 * Expects: skills may include duplicates; the first entry per path is used.
 */
export function skillPromptFormat(skills: AgentSkill[]): string {
  const unique = new Map<string, AgentSkill>();
  for (const skill of skills) {
    if (!unique.has(skill.path)) {
      unique.set(skill.path, skill);
    }
  }
  const ordered = skillSort(Array.from(unique.values()));

  if (ordered.length === 0) {
    return "";
  }

  const lines = [
    "<skills>",
    "  <instructions>",
    "    <mandatory>Before replying, scan the skill descriptions below. If exactly one skill clearly applies, read its SKILL.md at the path shown, then follow it. If multiple could apply, choose the most specific one. If none clearly apply, do not read any SKILL.md. Never read more than one skill up front.</mandatory>",
    "    <load>Read the skill file to load it.</load>",
    "    <reload>Read the skill file again to reload it.</reload>",
    "    <unload>Explicitly ignore the skill guidance to unload it.</unload>",
    "  </instructions>",
    "  <available>"
  ];

  for (const skill of ordered) {
    const sourceLabel =
      skill.source === "plugin"
        ? `plugin:${skill.pluginId ?? "unknown"}`
        : skill.source;
    const name = xmlEscape(skill.name);
    const description = skill.description ? xmlEscape(skill.description) : "";
    lines.push("    <skill>");
    lines.push(`      <name>${name}</name>`);
    if (description.length > 0) {
      lines.push(`      <description>${description}</description>`);
    }
    lines.push(`      <source>${xmlEscape(sourceLabel)}</source>`);
    lines.push(`      <path>${xmlEscape(skill.path)}</path>`);
    lines.push("    </skill>");
  }

  lines.push("  </available>");
  lines.push("</skills>");

  return lines.join("\n");
}
