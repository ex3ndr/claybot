import {
  confirm,
  intro,
  isCancel,
  outro,
  password,
  select,
  text
} from "@clack/prompts";
import { getModels } from "@mariozechner/pi-ai";

import { DEFAULT_AUTH_PATH, readAuthFile } from "../auth.js";
import { saveClaudeCodeAuth } from "../engine/client.js";

export type AddClaudeCodeOptions = {
  token?: string;
  model?: string;
  main?: boolean;
};

export async function addClaudeCodeCommand(
  options: AddClaudeCodeOptions
): Promise<void> {
  intro("scout add claude");

  const tokenInput =
    options.token ??
    (await password({
      message: "Claude Code token",
      validate: (value) => (value ? undefined : "Token is required")
    }));

  if (isCancel(tokenInput)) {
    outro("Canceled.");
    return;
  }

  const token = String(tokenInput);
  let model = options.model ?? "";
  if (!model) {
    const modelOptions = buildModelOptions("anthropic");
    const optionsList =
      modelOptions.length > 0
        ? [...modelOptions, { label: "Enter custom model id", value: "custom" }]
        : [{ label: "Enter custom model id", value: "custom" }];

    const selection = await select({
      message: "Select Claude Code model",
      options: optionsList
    });

    if (isCancel(selection)) {
      outro("Canceled.");
      return;
    }

    if (selection === "custom") {
      const custom = await text({
        message: "Claude Code model id",
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

  if (auth["claude-code"]?.token || auth.claude?.token) {
    const overwrite = await confirm({
      message: `Overwrite existing Claude Code token in ${DEFAULT_AUTH_PATH}?`,
      initialValue: false
    });

    if (isCancel(overwrite) || overwrite === false) {
      outro("Canceled.");
      return;
    }
  }

  await saveClaudeCodeAuth({ token, model, main: options.main });

  outro("Saved Claude Code auth.");
}

function buildModelOptions(provider: "anthropic") {
  const models = getModels(provider).map((model) => model.id);
  if (models.length === 0) {
    return [];
  }
  const latest = models.filter((id) => id.endsWith("-latest"));
  const rest = models.filter((id) => !latest.includes(id)).sort();
  const ordered = [...latest, ...rest];
  return ordered.map((id) => ({ label: id, value: id }));
}
