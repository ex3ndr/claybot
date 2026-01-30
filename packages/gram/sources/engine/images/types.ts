import type { FileReference } from "../../files/types.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { Logger } from "pino";

export type ImageGenerationRequest = {
  prompt: string;
  size?: string;
  count?: number;
  format?: "b64_json" | "url";
  model?: string;
};

export type ImageGenerationResult = {
  files: FileReference[];
};

export type ImageGenerationContext = {
  fileStore: FileStore;
  auth: AuthStore;
  logger: Logger;
};

export type ImageGenerationProvider = {
  id: string;
  label: string;
  generate: (
    request: ImageGenerationRequest,
    context: ImageGenerationContext
  ) => Promise<ImageGenerationResult>;
};
