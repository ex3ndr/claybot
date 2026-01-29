import { confirm, intro, isCancel, outro, password, text } from "@clack/prompts";

import type { InferenceProviderConfig } from "../auth.js";
import { DEFAULT_AUTH_PATH, readAuthFile, writeAuthFile } from "../auth.js";

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

  auth.codex = { token };
  auth.inference = {
    providers: updateProviders(
      auth.inference?.providers,
      { id: "codex", model },
      options.main
    )
  };
  await writeAuthFile(DEFAULT_AUTH_PATH, auth);

  outro(`Saved codex token to ${DEFAULT_AUTH_PATH}`);
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
