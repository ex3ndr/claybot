import { confirm, intro, isCancel, outro, password, text } from "@clack/prompts";
import path from "node:path";

import type { InferenceProviderConfig } from "../auth.js";
import { readAuthFile, writeAuthFile } from "../auth.js";

export type AddCodexOptions = {
  token?: string;
  model?: string;
  main?: boolean;
  output: string;
};

const DEFAULT_OUTPUT = ".scout/auth.json";

export async function addCodexCommand(options: AddCodexOptions): Promise<void> {
  intro("scout add codex");

  const outputPath = path.resolve(options.output || DEFAULT_OUTPUT);

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
  const modelInput =
    options.model ??
    (await text({
      message: "Codex model id",
      validate: (value) => (value ? undefined : "Model id is required")
    }));

  if (isCancel(modelInput)) {
    outro("Canceled.");
    return;
  }

  const model = String(modelInput);
  const auth = await readAuthFile(outputPath);

  if (auth.codex?.token) {
    const overwrite = await confirm({
      message: `Overwrite existing codex token in ${outputPath}?`,
      initialValue: false
    });

    if (isCancel(overwrite) || overwrite === false) {
      outro("Canceled.");
      return;
    }
  }

  auth.codex = { token };
  auth.inference = {
    providers: updateProviders(
      auth.inference?.providers,
      { id: "codex", model },
      options.main
    )
  };
  await writeAuthFile(outputPath, auth);

  outro(`Saved codex token to ${outputPath}`);
}

function updateProviders(
  providers: InferenceProviderConfig[] | undefined,
  entry: Omit<InferenceProviderConfig, "main">,
  makeMain?: boolean
): InferenceProviderConfig[] {
  const list = providers ?? [];
  const existing = list.find((item) => item.id === entry.id);
  const keepMain = makeMain === true ? true : existing?.main ?? false;
  const filtered = list.filter((item) => item.id !== entry.id);

  if (keepMain) {
    return [
      { ...entry, main: true },
      ...filtered.map((item) => ({ ...item, main: false }))
    ];
  }

  return [...filtered, { ...entry, main: false }];
}
