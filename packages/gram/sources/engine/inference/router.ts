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
    this.logger.debug({ providerCount: options.providers.length }, "[VERBOSE] InferenceRouter initialized");
  }

  updateProviders(providers: ProviderSettings[]): void {
    this.logger.debug(
      { oldCount: this.providers.length, newCount: providers.length, providerIds: providers.map(p => p.id) },
      "[VERBOSE] Updating providers"
    );
    this.providers = providers;
  }

  async complete(
    context: Context,
    sessionId: string,
    options?: Omit<InferenceRouterOptions, "providers" | "registry" | "auth">
  ): Promise<InferenceResult> {
    this.logger.debug(
      { sessionId, messageCount: context.messages.length, toolCount: context.tools?.length ?? 0, providerCount: this.providers.length },
      "[VERBOSE] InferenceRouter.complete() starting"
    );
    let lastError: unknown = null;

    for (const [index, providerConfig] of this.providers.entries()) {
      this.logger.debug(
        { providerIndex: index, providerId: providerConfig.id, model: providerConfig.model },
        "[VERBOSE] Trying provider"
      );

      const provider = this.registry.get(providerConfig.id);
      if (!provider) {
        this.logger.warn({ provider: providerConfig.id }, "Missing inference provider");
        this.logger.debug({ providerId: providerConfig.id }, "[VERBOSE] Provider not found in registry, skipping");
        continue;
      }

      let client;
      try {
        this.logger.debug({ providerId: providerConfig.id, model: providerConfig.model }, "[VERBOSE] Creating inference client");
        client = await provider.createClient({
          model: providerConfig.model,
          config: providerConfig.options,
          auth: this.auth,
          logger: this.logger
        });
        this.logger.debug({ providerId: providerConfig.id, modelId: client.modelId }, "[VERBOSE] Inference client created");
      } catch (error) {
        this.logger.debug({ providerId: providerConfig.id, error: String(error) }, "[VERBOSE] Failed to create client, falling back");
        lastError = error;
        options?.onFallback?.(providerConfig.id, error);
        continue;
      }

      options?.onAttempt?.(providerConfig.id, client.modelId);
      try {
        this.logger.debug(
          { providerId: providerConfig.id, modelId: client.modelId, sessionId },
          "[VERBOSE] Calling client.complete()"
        );
        const message = await client.complete(context, { sessionId });
        this.logger.debug(
          {
            providerId: providerConfig.id,
            modelId: client.modelId,
            stopReason: message.stopReason,
            contentBlocks: message.content.length,
            inputTokens: message.usage?.input,
            outputTokens: message.usage?.output
          },
          "[VERBOSE] Inference completed successfully"
        );
        options?.onSuccess?.(providerConfig.id, client.modelId, message);
        return { message, providerId: providerConfig.id, modelId: client.modelId };
      } catch (error) {
        this.logger.debug({ providerId: providerConfig.id, error: String(error) }, "[VERBOSE] Inference call failed");
        options?.onFailure?.(providerConfig.id, error);
        throw error;
      }
    }

    this.logger.debug({ lastError: String(lastError) }, "[VERBOSE] All providers exhausted");
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("No inference provider available");
  }
}
