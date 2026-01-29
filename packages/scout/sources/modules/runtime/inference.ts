import {
  complete,
  getModel,
  getModels,
  stream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ProviderStreamOptions
} from "@mariozechner/pi-ai";

import type { AuthConfig, InferenceProviderConfig } from "../../auth.js";
import {
  DEFAULT_AUTH_PATH,
  getClaudeCodeToken,
  getCodexToken,
  readAuthFile
} from "../../auth.js";

export type InferenceClient = {
  model: Model<Api>;
  complete: (
    context: Context,
    options?: ProviderStreamOptions
  ) => Promise<AssistantMessage>;
  stream: (
    context: Context,
    options?: ProviderStreamOptions
  ) => AssistantMessageEventStream;
};

export type InferenceConnectOptions = {
  model?: string;
  token?: string;
};

export type InferenceRuntime = {
  providers: InferenceProviderConfig[];
  codexToken?: string | null;
  claudeCodeToken?: string | null;
  auth?: AuthConfig;
  onAttempt?: (provider: InferenceProviderConfig, modelId: string) => void;
  onFallback?: (provider: InferenceProviderConfig, error: unknown) => void;
  onSuccess?: (
    provider: InferenceProviderConfig,
    modelId: string,
    message: AssistantMessage
  ) => void;
  onFailure?: (provider: InferenceProviderConfig, error: unknown) => void;
};

export type InferenceResult = {
  message: AssistantMessage;
  provider: InferenceProviderConfig;
};

export async function connectCodex(
  options: InferenceConnectOptions
): Promise<InferenceClient> {
  const apiKey = await resolveToken(options, getCodexToken, "codex");
  const modelId = resolveModelId("openai-codex", options.model);
  const model = getModel("openai-codex", modelId as never);
  if (!model) {
    throw new Error(`Unknown codex model: ${modelId}`);
  }
  return buildClient(model as Model<Api>, apiKey);
}

export async function connectClaudeCode(
  options: InferenceConnectOptions
): Promise<InferenceClient> {
  const apiKey = await resolveToken(options, getClaudeCodeToken, "claude-code");
  const modelId = resolveModelId("anthropic", options.model);
  const model = getModel("anthropic", modelId as never);
  if (!model) {
    throw new Error(`Unknown claude-code model: ${modelId}`);
  }
  return buildClient(model as Model<Api>, apiKey);
}

export async function runInferenceWithFallback(
  runtime: InferenceRuntime,
  context: Context,
  sessionId: string
): Promise<InferenceResult> {
  let lastError: unknown = null;

  for (const provider of runtime.providers) {
    let client: InferenceClient;
    try {
      client = await connectProvider(provider, runtime);
    } catch (error) {
      lastError = error;
      if (runtime.onFallback) {
        runtime.onFallback(provider, error);
      }
      continue;
    }

    runtime.onAttempt?.(provider, client.model.id);
    try {
      const message = await client.complete(context, { sessionId });
      runtime.onSuccess?.(provider, client.model.id, message);
      return { message, provider };
    } catch (error) {
      runtime.onFailure?.(provider, error);
      throw error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("No inference provider available");
}

async function resolveToken(
  options: InferenceConnectOptions,
  picker: (auth: Awaited<ReturnType<typeof readAuthFile>>) => string | null,
  label: string
): Promise<string> {
  if (options.token) {
    return options.token;
  }

  const auth = await readAuthFile(DEFAULT_AUTH_PATH);
  const token = picker(auth);

  if (!token) {
    throw new Error(`Missing ${label} token in ${DEFAULT_AUTH_PATH}`);
  }

  return token;
}

async function connectProvider(
  provider: InferenceProviderConfig,
  runtime: InferenceRuntime
): Promise<InferenceClient> {
  switch (provider.id) {
    case "codex":
      return connectCodex({
        model: resolveProviderModel(provider, runtime),
        token: runtime.codexToken ?? undefined
      });
    case "claude-code":
      return connectClaudeCode({
        model: resolveProviderModel(provider, runtime),
        token: runtime.claudeCodeToken ?? undefined
      });
    default:
      throw new Error(`Unsupported inference provider: ${provider.id}`);
  }
}

function resolveProviderModel(
  provider: InferenceProviderConfig,
  runtime: InferenceRuntime
): string | undefined {
  if (provider.model) {
    return provider.model;
  }

  const auth = runtime.auth;
  if (!auth) {
    return undefined;
  }

  switch (provider.id) {
    case "codex":
      return auth.codex?.model ?? auth["openai-codex"]?.model;
    case "claude-code":
      return auth["claude-code"]?.model ?? auth.claude?.model;
    default:
      return undefined;
  }
}

function resolveModelId(
  provider: "openai-codex" | "anthropic",
  preferred?: string
): string {
  const models = getModels(provider);
  if (models.length === 0) {
    throw new Error(`No models available for provider ${provider}`);
  }

  if (preferred) {
    const match = models.find((model) => model.id === preferred);
    if (match) {
      return match.id;
    }
  }

  const latest =
    models.find((model) => model.id.endsWith("-latest")) ??
    models.find((model) => model.id.includes("latest"));
  return latest?.id ?? models[0]!.id;
}

function buildClient(
  model: Model<Api>,
  apiKey: string
): InferenceClient {
  return {
    model,
    complete: (context, options) =>
      complete(model, context, { ...options, apiKey: options?.apiKey ?? apiKey }),
    stream: (context, options) =>
      stream(model, context, { ...options, apiKey: options?.apiKey ?? apiKey })
  };
}
