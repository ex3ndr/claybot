import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  ProviderStreamOptions
} from "@mariozechner/pi-ai";
import type { Logger } from "pino";

import type { AuthStore } from "../../auth/store.js";

export type InferenceClient = {
  modelId: string;
  complete: (
    context: Context,
    options?: ProviderStreamOptions
  ) => Promise<AssistantMessage>;
  stream: (
    context: Context,
    options?: ProviderStreamOptions
  ) => AssistantMessageEventStream;
};

export type InferenceProviderOptions = {
  model?: string;
  config?: Record<string, unknown>;
  auth: AuthStore;
  logger: Logger;
};

export type InferenceProvider = {
  id: string;
  label: string;
  createClient: (options: InferenceProviderOptions) => Promise<InferenceClient>;
};
