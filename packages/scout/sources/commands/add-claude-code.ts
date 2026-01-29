import {
  confirm,
  intro,
  isCancel,
  outro,
  password,
  select,
  text
} from "@clack/prompts";

import type { InferenceProviderConfig } from "../auth.js";
import { DEFAULT_AUTH_PATH, readAuthFile, writeAuthFile } from "../auth.js";

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
    const selection = await select({
      message: "Select Claude Code model",
      options: [
        { label: "claude-3-5-sonnet-latest", value: "claude-3-5-sonnet-latest" },
        { label: "claude-3-5-haiku-latest", value: "claude-3-5-haiku-latest" },
        { label: "claude-3-opus-latest", value: "claude-3-opus-latest" },
        { label: "Enter custom model id", value: "custom" }
      ]
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

  auth["claude-code"] = { token, model };
  auth.inference = {
    providers: updateProviders(auth.inference?.providers, {
      id: "claude-code",
      model,
      main: options.main
    })
  };
  await writeAuthFile(DEFAULT_AUTH_PATH, auth);

  outro(`Saved Claude Code auth to ${DEFAULT_AUTH_PATH}`);
}

function updateProviders(
  providers: InferenceProviderConfig[] | undefined,
  entry: InferenceProviderConfig
): InferenceProviderConfig[] {
  const list = (providers ?? []).filter((item) => item.id !== entry.id);
  if (entry.main) {
    return [
      { ...entry, main: true },
      ...list.map((item) => ({ ...item, main: false }))
    ];
  }
  return [...list, { ...entry, main: false }];
}
