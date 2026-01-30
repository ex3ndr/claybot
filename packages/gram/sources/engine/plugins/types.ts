import type { Logger } from "pino";
import type { ZodType } from "zod";

import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { InferenceProviderSettings, PluginInstanceSettings, SettingsConfig } from "../../settings.js";
import type { PluginEventInput } from "./events.js";
import type { PluginRegistrar } from "./registry.js";
import type { EngineEventBus } from "../ipc/events.js";

export type PluginApi<TSettings = unknown> = {
  instance: PluginInstanceSettings;
  settings: TSettings;
  engineSettings: SettingsConfig;
  logger: Logger;
  auth: AuthStore;
  dataDir: string;
  registrar: PluginRegistrar;
  fileStore: FileStore;
  mode: "runtime" | "validate";
  engineEvents?: EngineEventBus;
  events: {
    emit: (event: PluginEventInput) => void;
  };
};

export type PluginInstance = {
  load?: () => Promise<void>;
  unload?: () => Promise<void>;
};

export type PromptChoice<TValue extends string> = {
  value: TValue;
  name: string;
  description?: string;
};

export type PromptSelectConfig<TValue extends string> = {
  message: string;
  choices: Array<PromptChoice<TValue>>;
};

export type PromptInputConfig = {
  message: string;
  default?: string;
  placeholder?: string;
};

export type PromptConfirmConfig = {
  message: string;
  default?: boolean;
};

export type PluginPrompt = {
  input: (config: PromptInputConfig) => Promise<string | null>;
  confirm: (config: PromptConfirmConfig) => Promise<boolean | null>;
  select: <TValue extends string>(
    config: PromptSelectConfig<TValue>
  ) => Promise<TValue | null>;
};

export type PluginOnboardingApi = {
  instanceId: string;
  pluginId: string;
  auth: AuthStore;
  prompt: PluginPrompt;
  note: (message: string, title?: string) => void;
};

export type PluginOnboardingResult = {
  settings?: Record<string, unknown>;
  inference?: InferenceProviderSettings;
};

export type PluginModule<TSettings = unknown> = {
  settingsSchema: ZodType<TSettings>;
  create: (api: PluginApi<TSettings>) => PluginInstance | Promise<PluginInstance>;
  onboarding?: (api: PluginOnboardingApi) => Promise<PluginOnboardingResult | null>;
};

export function definePlugin<TSettings>(
  module: PluginModule<TSettings>
): PluginModule<TSettings> {
  return module;
}
