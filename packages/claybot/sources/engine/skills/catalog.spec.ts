import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { formatSkillsPrompt, listAgentSkills } from "./catalog.js";

describe("listAgentSkills", () => {
  it("collects core and plugin skills with full paths", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "claybot-skills-"));
    try {
      const coreDir = path.join(baseDir, "core");
      const pluginSkillsDir = path.join(baseDir, "plugins", "alpha", "skills");
      await fs.mkdir(coreDir, { recursive: true });
      await fs.mkdir(pluginSkillsDir, { recursive: true });

      const coreSkillPath = path.join(coreDir, "deploy.md");
      const pluginSkillPath = path.join(pluginSkillsDir, "report.md");
      await fs.writeFile(coreSkillPath, "Core skill");
      await fs.writeFile(pluginSkillPath, "Plugin skill");

      const skills = await listAgentSkills([
        { type: "core", root: coreDir },
        { type: "plugin", pluginId: "alpha", root: pluginSkillsDir }
      ]);

      expect(skills).toHaveLength(2);
      const coreSkill = skills.find((skill) => skill.id.startsWith("core:"));
      const pluginSkill = skills.find((skill) => skill.id.startsWith("plugin:alpha/"));

      expect(coreSkill?.path).toBe(coreSkillPath);
      expect(pluginSkill?.path).toBe(pluginSkillPath);

      const prompt = formatSkillsPrompt(skills);
      expect(prompt).toContain(coreSkillPath);
      expect(prompt).toContain(pluginSkillPath);
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});
