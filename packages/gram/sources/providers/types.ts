import type { Logger } from "pino";

import type { AuthStore } from "../auth/store.js";
import type { ProviderSettings } from "../settings.js";
import type { FileStore } from "../files/store.js";
import type { InferenceRegistry, ImageGenerationRegistry } from "../engine/modules.js";

export type ProviderAuth = "apiKey" | "oauth" | "mixed" | "none";

export type ProviderModelSize = "unknown" | "large" | "normal" | "small";

export type ProviderModelInfo = {
  id: string;
  name: string;
  size: ProviderModelSize;
};

export type ProviderPromptChoice<TValue extends string> = {
  value: TValue;
  name: string;
  description?: string;
};

export type ProviderPromptSelectConfig<TValue extends string> = {
  message: string;
  choices: Array<ProviderPromptChoice<TValue>>;
};

export type ProviderPromptInputConfig = {
  message: string;
  default?: string;
  placeholder?: string;
};

export type ProviderPromptConfirmConfig = {
  message: string;
  default?: boolean;
};

export type ProviderPrompt = {
  input: (config: ProviderPromptInputConfig) => Promise<string | null>;
  confirm: (config: ProviderPromptConfirmConfig) => Promise<boolean | null>;
  select: <TValue extends string>(
    config: ProviderPromptSelectConfig<TValue>
  ) => Promise<TValue | null>;
};

export type ProviderOnboardingApi = {
  id: string;
  auth: AuthStore;
  prompt: ProviderPrompt;
  note: (message: string, title?: string) => void;
};

export type ProviderOnboardingResult = {
  settings?: Partial<ProviderSettings>;
};

export type ProviderContext = {
  settings: ProviderSettings;
  auth: AuthStore;
  fileStore: FileStore;
  inferenceRegistry: InferenceRegistry;
  imageRegistry: ImageGenerationRegistry;
  logger: Logger;
};

export type ProviderInstance = {
  load?: () => Promise<void>;
  unload?: () => Promise<void>;
};

export type ProviderDefinition = {
  id: string;
  name: string;
  description: string;
  auth: ProviderAuth;
  models?: ProviderModelInfo[];
  capabilities: {
    inference?: boolean;
    image?: boolean;
  };
  create: (context: ProviderContext) => ProviderInstance | Promise<ProviderInstance>;
  onboarding?: (api: ProviderOnboardingApi) => Promise<ProviderOnboardingResult | null>;
};
