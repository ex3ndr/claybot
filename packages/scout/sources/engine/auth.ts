import type {
  AuthConfig,
  InferenceProviderConfig
} from "../auth.js";

export type CodexAuthUpdate = {
  token: string;
  model: string;
  main?: boolean;
};

export type ClaudeCodeAuthUpdate = {
  token: string;
  model: string;
  main?: boolean;
};

export function applyTelegramAuthUpdate(
  auth: AuthConfig,
  token: string
): AuthConfig {
  return {
    ...auth,
    telegram: { token }
  };
}

export function removeTelegramAuth(auth: AuthConfig): AuthConfig {
  return omitAuthKey(auth, "telegram");
}

export function applyCodexAuthUpdate(
  auth: AuthConfig,
  update: CodexAuthUpdate
): AuthConfig {
  const providers = updateCodexProviders(
    auth.inference?.providers,
    { id: "codex", model: update.model },
    update.main
  );

  return {
    ...auth,
    codex: { token: update.token },
    inference: { providers }
  };
}

export function removeCodexAuth(auth: AuthConfig): AuthConfig {
  const providers = removeProvider(auth.inference?.providers, "codex");
  return {
    ...omitAuthKey(auth, "codex"),
    inference: { providers }
  };
}

export function applyClaudeCodeAuthUpdate(
  auth: AuthConfig,
  update: ClaudeCodeAuthUpdate
): AuthConfig {
  const providers = updateClaudeProviders(
    auth.inference?.providers,
    {
      id: "claude-code",
      model: update.model,
      main: update.main
    }
  );

  return {
    ...auth,
    "claude-code": { token: update.token, model: update.model },
    inference: { providers }
  };
}

export function removeClaudeCodeAuth(auth: AuthConfig): AuthConfig {
  const providers = removeProvider(auth.inference?.providers, "claude-code");
  return {
    ...omitAuthKey(auth, "claude-code"),
    inference: { providers }
  };
}

function updateCodexProviders(
  providers: InferenceProviderConfig[] | undefined,
  entry: Omit<InferenceProviderConfig, "main">,
  makeMain?: boolean
): InferenceProviderConfig[] {
  const list = providers ?? [];
  const existing = list.find((item) => item.id === entry.id);
  const keepMain = makeMain === true ? true : existing?.main ?? false;
  const filtered = list.filter((item) => item.id !== entry.id);

  if (keepMain) {
    return [
      { ...entry, main: true },
      ...filtered.map((item) => ({ ...item, main: false }))
    ];
  }

  return [...filtered, { ...entry, main: false }];
}

function updateClaudeProviders(
  providers: InferenceProviderConfig[] | undefined,
  entry: InferenceProviderConfig
): InferenceProviderConfig[] {
  const list = (providers ?? []).filter((item) => item.id !== entry.id);
  if (entry.main) {
    return [
      { ...entry, main: true },
      ...list.map((item) => ({ ...item, main: false }))
    ];
  }
  return [...list, { ...entry, main: false }];
}

function removeProvider(
  providers: InferenceProviderConfig[] | undefined,
  id: InferenceProviderConfig["id"]
): InferenceProviderConfig[] {
  return (providers ?? []).filter((item) => item.id !== id);
}

function omitAuthKey<K extends keyof AuthConfig>(
  auth: AuthConfig,
  key: K
): AuthConfig {
  const copy = { ...auth };
  delete copy[key];
  return copy;
}
