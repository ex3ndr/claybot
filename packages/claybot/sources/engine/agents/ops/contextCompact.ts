import { createId } from "@paralleldrive/cuid2";
import type { Context } from "@mariozechner/pi-ai";

import { getLogger } from "../../../log.js";
import type { ProviderSettings } from "../../../settings.js";
import type { InferenceRouter } from "../../modules/inference/router.js";
import { getProviderDefinition } from "../../../providers/catalog.js";
import { providerModelSelectBySize } from "../../../providers/providerModelSelectBySize.js";
import { messageExtractText } from "../../messages/messageExtractText.js";
import { agentPromptBundledRead } from "./agentPromptBundledRead.js";

type ContextCompactOptions = {
  context: Context;
  inferenceRouter: InferenceRouter;
  providers: ProviderSettings[];
  providerId?: string;
  agentId?: string;
};

const logger = getLogger("agents.context-compact");

/**
 * Compacts a conversation context into a single summary message.
 * Expects: context contains the full session messages to compress.
 */
export async function contextCompact(options: ContextCompactOptions): Promise<Context> {
  const { context, inferenceRouter, providers, providerId, agentId } = options;
  if (!context.messages || context.messages.length === 0) {
    return { messages: [] };
  }

  const compactionPrompt = (await agentPromptBundledRead("COMPACTION.md")).trim();
  const compactionContext: Context = {
    messages: [...context.messages],
    systemPrompt: compactionPrompt
  };

  const selectedProviders = providerId
    ? providers.filter((provider) => provider.id === providerId)
    : providers;
  if (providerId && selectedProviders.length === 0) {
    throw new Error(`Unknown inference provider: ${providerId}`);
  }
  if (selectedProviders.length === 0) {
    throw new Error("No inference provider available");
  }

  const providersOverride = selectedProviders.map((provider) => {
    const definition = getProviderDefinition(provider.id);
    const models = definition?.models ?? [];
    const normalModel = providerModelSelectBySize(models, "normal");
    if (!normalModel) {
      return { ...provider };
    }
    return { ...provider, model: normalModel };
  });

  logger.debug(
    `contextCompact starting messageCount=${context.messages.length} providerCount=${providersOverride.length}`
  );
  const response = await inferenceRouter.complete(
    compactionContext,
    agentId ?? `compaction:${createId()}`,
    {
      providersOverride
    }
  );

  const summaryText = messageExtractText(response.message)?.trim();
  if (!summaryText) {
    logger.debug("contextCompact produced empty summary; returning original context");
    return { messages: [...context.messages] };
  }

  return {
    messages: [
      {
        ...response.message,
        content: [{ type: "text", text: summaryText }]
      }
    ]
  };
}
