import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pluginDescriptorSchema, type PluginDescriptor } from "./descriptor.js";

export type PluginDefinition = {
  descriptor: PluginDescriptor;
  entryPath: string;
  descriptorPath: string;
  pluginDir: string;
};

const pluginsDir = fileURLToPath(new URL("../../plugins", import.meta.url));

function collectDescriptorFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...collectDescriptorFiles(path.join(root, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name === "descriptor.json") {
      results.push(path.join(root, entry.name));
    }
  }
  return results;
}

const descriptorFiles = collectDescriptorFiles(pluginsDir);

export function buildPluginCatalog(): Map<string, PluginDefinition> {
  const catalog = new Map<string, PluginDefinition>();

  for (const descriptorPath of descriptorFiles) {
    const raw = fs.readFileSync(descriptorPath, "utf8");
    const parsed = pluginDescriptorSchema.parse(JSON.parse(raw));
    const pluginDir = path.dirname(descriptorPath);
    const entryPath = path.resolve(pluginDir, parsed.entry);
    catalog.set(parsed.id, {
      descriptor: parsed,
      entryPath,
      descriptorPath,
      pluginDir
    });
  }

  return catalog;
}
