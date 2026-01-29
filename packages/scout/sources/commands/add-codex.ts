import { confirm, intro, isCancel, outro, password, select, text } from "@clack/prompts";
import { getModels } from "@mariozechner/pi-ai";

import { DEFAULT_AUTH_PATH, readAuthFile } from "../auth.js";
import { saveCodexAuth } from "../engine/client.js";

export type AddCodexOptions = {
  token?: string;
  model?: string;
  main?: boolean;
};

export async function addCodexCommand(options: AddCodexOptions): Promise<void> {
  intro("scout add codex");

  const tokenInput =
    options.token ??
    (await password({
      message: "Codex token",
      validate: (value) => (value ? undefined : "Token is required")
    }));

  if (isCancel(tokenInput)) {
    outro("Canceled.");
    return;
  }

  const token = String(tokenInput);
  let model = options.model ?? "";
  if (!model) {
    const modelOptions = buildModelOptions("openai-codex");
    const optionsList =
      modelOptions.length > 0
        ? [...modelOptions, { label: "Enter custom model id", value: "custom" }]
        : [{ label: "Enter custom model id", value: "custom" }];

    const selection = await select({
      message: "Select Codex model",
      options: optionsList
    });

    if (isCancel(selection)) {
      outro("Canceled.");
      return;
    }

    if (selection === "custom") {
      const custom = await text({
        message: "Codex model id",
        validate: (value) => (value ? undefined : "Model id is required")
      });

      if (isCancel(custom)) {
        outro("Canceled.");
        return;
      }

      model = String(custom);
    } else {
      model = String(selection);
    }
  }
  const auth = await readAuthFile(DEFAULT_AUTH_PATH);

  if (auth.codex?.token) {
    const overwrite = await confirm({
      message: `Overwrite existing codex token in ${DEFAULT_AUTH_PATH}?`,
      initialValue: false
    });

    if (isCancel(overwrite) || overwrite === false) {
      outro("Canceled.");
      return;
    }
  }

  await saveCodexAuth({ token, model, main: options.main });

  outro("Saved Codex auth.");
}

function buildModelOptions(provider: "openai-codex") {
  const models = getModels(provider).map((model) => model.id);
  if (models.length === 0) {
    return [];
  }
  const latest = models.filter((id) => id.endsWith("-latest"));
  const rest = models.filter((id) => !latest.includes(id)).sort();
  const ordered = [...latest, ...rest];
  return ordered.map((id) => ({ label: id, value: id }));
}
