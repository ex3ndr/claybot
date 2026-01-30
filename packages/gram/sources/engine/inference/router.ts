import type { Context, AssistantMessage } from "@mariozechner/pi-ai";

import type { InferenceRegistry } from "../modules.js";
import type { ProviderSettings } from "../../settings.js";
import type { AuthStore } from "../../auth/store.js";
import { getLogger } from "../../log.js";

export type InferenceResult = {
  message: AssistantMessage;
  providerId: string;
  modelId: string;
};

export type InferenceRouterOptions = {
  providers: ProviderSettings[];
  registry: InferenceRegistry;
  auth: AuthStore;
  onAttempt?: (providerId: string, modelId: string) => void;
  onFallback?: (providerId: string, error: unknown) => void;
  onSuccess?: (providerId: string, modelId: string, message: AssistantMessage) => void;
  onFailure?: (providerId: string, error: unknown) => void;
  providersOverride?: ProviderSettings[];
};

export class InferenceRouter {
  private providers: ProviderSettings[];
  private registry: InferenceRegistry;
  private auth: AuthStore;
  private logger = getLogger("inference.router");

  constructor(options: InferenceRouterOptions) {
    this.providers = options.providers;
    this.registry = options.registry;
    this.auth = options.auth;
    this.logger.debug(`InferenceRouter initialized providerCount=${options.providers.length}`);
  }

  updateProviders(providers: ProviderSettings[]): void {
    const providerIds = providers.map(p => p.id).join(",");
    this.logger.debug(`Updating providers oldCount=${this.providers.length} newCount=${providers.length} providerIds=${providerIds}`);
    this.providers = providers;
  }

  async complete(
    context: Context,
    sessionId: string,
    options?: Omit<InferenceRouterOptions, "providers" | "registry" | "auth">
  ): Promise<InferenceResult> {
    const providers = options?.providersOverride ?? this.providers;
    this.logger.debug(`InferenceRouter.complete() starting sessionId=${sessionId} messageCount=${context.messages.length} toolCount=${context.tools?.length ?? 0} providerCount=${providers.length}`);
    let lastError: unknown = null;

    for (const [index, providerConfig] of providers.entries()) {
      this.logger.debug(`Trying provider providerIndex=${index} providerId=${providerConfig.id} model=${providerConfig.model}`);

      const provider = this.registry.get(providerConfig.id);
      if (!provider) {
        this.logger.warn({ provider: providerConfig.id }, "Missing inference provider");
        this.logger.debug(`Provider not found in registry, skipping providerId=${providerConfig.id}`);
        continue;
      }

      let client;
      try {
        this.logger.debug(`Creating inference client providerId=${providerConfig.id} model=${providerConfig.model}`);
        client = await provider.createClient({
          model: providerConfig.model,
          config: providerConfig.options,
          auth: this.auth,
          logger: this.logger
        });
        this.logger.debug(`Inference client created providerId=${providerConfig.id} modelId=${client.modelId}`);
      } catch (error) {
        this.logger.debug(`Failed to create client, falling back providerId=${providerConfig.id} error=${String(error)}`);
        lastError = error;
        options?.onFallback?.(providerConfig.id, error);
        continue;
      }

      options?.onAttempt?.(providerConfig.id, client.modelId);
      try {
        this.logger.debug(`Calling client.complete() providerId=${providerConfig.id} modelId=${client.modelId} sessionId=${sessionId}`);
        const message = await client.complete(context, { sessionId });
        this.logger.debug(`Inference completed successfully providerId=${providerConfig.id} modelId=${client.modelId} stopReason=${message.stopReason} contentBlocks=${message.content.length} inputTokens=${message.usage?.input} outputTokens=${message.usage?.output}`);
        options?.onSuccess?.(providerConfig.id, client.modelId, message);
        return { message, providerId: providerConfig.id, modelId: client.modelId };
      } catch (error) {
        this.logger.debug(`Inference call failed providerId=${providerConfig.id} error=${String(error)}`);
        options?.onFailure?.(providerConfig.id, error);
        throw error;
      }
    }

    this.logger.debug(`All providers exhausted lastError=${String(lastError)}`);
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("No inference provider available");
  }
}
