import { promises as fs } from "node:fs";
import path from "node:path";

export type AuthEntry = {
  token: string;
  model?: string;
};

export type InferenceProviderId = "codex" | "claude-code";

export type InferenceProviderConfig = {
  id: InferenceProviderId;
  model: string;
  main?: boolean;
};

export type InferenceConfig = {
  providers?: InferenceProviderConfig[];
};

export type AuthConfig = {
  telegram?: AuthEntry;
  codex?: AuthEntry;
  "openai-codex"?: AuthEntry;
  "claude-code"?: AuthEntry;
  claude?: AuthEntry;
  inference?: InferenceConfig;
};

export const DEFAULT_AUTH_PATH = ".scout/auth.json";

export async function readAuthFile(
  filePath: string = DEFAULT_AUTH_PATH
): Promise<AuthConfig> {
  const resolvedPath = path.resolve(filePath);

  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    return JSON.parse(raw) as AuthConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeAuthFile(
  filePath: string,
  auth: AuthConfig
): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);

  if (dir && dir !== ".") {
    await fs.mkdir(dir, { recursive: true });
  }

  await fs.writeFile(resolvedPath, `${JSON.stringify(auth, null, 2)}\n`, {
    mode: 0o600
  });
}

export async function updateAuthFile(
  filePath: string,
  updater: (auth: AuthConfig) => AuthConfig
): Promise<AuthConfig> {
  const auth = await readAuthFile(filePath);
  const updated = updater(auth);
  await writeAuthFile(filePath, updated);
  return updated;
}

export function getCodexToken(auth: AuthConfig): string | null {
  return auth.codex?.token ?? auth["openai-codex"]?.token ?? null;
}

export function getClaudeCodeToken(auth: AuthConfig): string | null {
  return auth["claude-code"]?.token ?? auth.claude?.token ?? null;
}

export function getInferenceProviders(
  auth: AuthConfig
): InferenceProviderConfig[] {
  const providers = auth.inference?.providers ?? [];
  if (providers.length === 0) {
    return [];
  }

  const mainProviders = providers.filter((entry) => entry.main);
  if (mainProviders.length === 0) {
    return [...providers];
  }

  return [
    ...mainProviders,
    ...providers.filter((entry) => !entry.main)
  ];
}
