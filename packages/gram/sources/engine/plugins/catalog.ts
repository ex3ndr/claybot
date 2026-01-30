import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pluginDescriptorSchema, type PluginDescriptor } from "./descriptor.js";

export type PluginDefinition = {
  descriptor: PluginDescriptor;
  entryPath: string;
};

const descriptorsDir = fileURLToPath(new URL("./descriptors", import.meta.url));
const descriptorFiles = fs
  .readdirSync(descriptorsDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => path.join(descriptorsDir, file));

export function buildPluginCatalog(): Map<string, PluginDefinition> {
  const catalog = new Map<string, PluginDefinition>();

  for (const descriptorPath of descriptorFiles) {
    const raw = fs.readFileSync(descriptorPath, "utf8");
    const parsed = pluginDescriptorSchema.parse(JSON.parse(raw));
    const entryPath = path.resolve(path.dirname(descriptorPath), parsed.entry);
    catalog.set(parsed.id, { descriptor: parsed, entryPath });
  }

  return catalog;
}
