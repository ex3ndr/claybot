import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PluginModule } from "./types.js";

const jsExtensions = [".js", ".mjs", ".cjs"];
const tsExtensions = [".ts", ".tsx", ".mts", ".cts"];
const moduleExtensions = [...jsExtensions, ...tsExtensions, ".json"];

export type PluginSandbox = {
  context: null;
  module: PluginModule;
};

export class PluginModuleLoader {
  private moduleCache = new Map<string, Promise<PluginModule>>();

  constructor(_contextName: string) {}

  async load(entryPath: string): Promise<PluginSandbox> {
    const resolved = await resolveFile(entryPath, process.cwd());
    if (!resolved) {
      throw new Error(`Plugin entry not found: ${entryPath}`);
    }
    const module = await this.loadResolved(resolved);
    return { context: null, module };
  }

  private async loadResolved(resolvedPath: string): Promise<PluginModule> {
    const cached = this.moduleCache.get(resolvedPath);
    if (cached) {
      return cached;
    }

    const loading = (async () => {
      if (path.extname(resolvedPath) === ".json") {
        const raw = await fs.readFile(resolvedPath, "utf8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        const plugin = data.plugin ?? data.default;
        if (!plugin) {
          throw new Error(`Plugin module did not export a plugin: ${resolvedPath}`);
        }
        return plugin as PluginModule;
      }

      const mod = (await import(pathToFileURL(resolvedPath).href)) as Record<string, unknown>;
      const plugin = mod.plugin ?? mod.default;
      if (!plugin) {
        throw new Error(`Plugin module did not export a plugin: ${resolvedPath}`);
      }
      return plugin as PluginModule;
    })();

    this.moduleCache.set(resolvedPath, loading);
    return loading;
  }
}

async function resolveFile(target: string, basePath: string): Promise<string | null> {
  const stats = await statIfExists(target);
  if (stats?.isFile()) {
    return target;
  }

  if (stats?.isDirectory()) {
    for (const ext of moduleExtensions) {
      const candidate = path.join(target, `index${ext}`);
      if (await statIfExists(candidate)) {
        return candidate;
      }
    }
  }

  const ext = path.extname(target);
  if (ext) {
    if (ext === ".js" || ext === ".mjs") {
      for (const replacement of [".ts", ".tsx", ".mts"]) {
        const candidate = target.replace(ext, replacement);
        if (await statIfExists(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  for (const extension of moduleExtensions) {
    const candidate = `${target}${extension}`;
    if (await statIfExists(candidate)) {
      return candidate;
    }
  }

  const nodeRequire = createRequire(path.join(basePath, "index.js"));
  try {
    const resolved = nodeRequire.resolve(target);
    return resolved;
  } catch {
    return null;
  }
}

async function statIfExists(
  target: string
): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}
