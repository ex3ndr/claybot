import {
  complete,
  getModel,
  stream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ProviderStreamOptions
} from "@mariozechner/pi-ai";

import type { InferenceProviderConfig } from "../../auth.js";
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
  authPath?: string;
};

export type InferenceRuntime = {
  providers: InferenceProviderConfig[];
  codexToken?: string | null;
  claudeCodeToken?: string | null;
  authPath?: string;
};

export type InferenceResult = {
  message: AssistantMessage;
  provider: InferenceProviderConfig;
};

export async function connectCodex(
  options: InferenceConnectOptions
): Promise<InferenceClient> {
  if (!options.model) {
    throw new Error("Missing codex model id");
  }
  const apiKey = await resolveToken(options, getCodexToken, "codex");
  const model = getModel("openai-codex", options.model as never);
  return buildClient(model as Model<Api>, apiKey);
}

export async function connectClaudeCode(
  options: InferenceConnectOptions
): Promise<InferenceClient> {
  if (!options.model) {
    throw new Error("Missing claude-code model id");
  }
  const apiKey = await resolveToken(options, getClaudeCodeToken, "claude-code");
  const model = getModel("anthropic", options.model as never);
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
      continue;
    }

    const message = await client.complete(context, { sessionId });
    return { message, provider };
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

  const authPath = options.authPath ?? DEFAULT_AUTH_PATH;
  const auth = await readAuthFile(authPath);
  const token = picker(auth);

  if (!token) {
    throw new Error(`Missing ${label} token in ${authPath}`);
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
        model: provider.model,
        token: runtime.codexToken ?? undefined,
        authPath: runtime.authPath
      });
    case "claude-code":
      return connectClaudeCode({
        model: provider.model,
        token: runtime.claudeCodeToken ?? undefined,
        authPath: runtime.authPath
      });
    default:
      throw new Error(`Unsupported inference provider: ${provider.id}`);
  }
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
