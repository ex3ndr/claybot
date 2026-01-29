import { confirm, intro, isCancel, outro } from "@clack/prompts";

import { DEFAULT_AUTH_PATH, readAuthFile } from "../auth.js";
import { removeTelegramAuth } from "../engine/client.js";

export type RemoveTelegramOptions = {
  force?: boolean;
};

export async function removeTelegramCommand(
  options: RemoveTelegramOptions
): Promise<void> {
  intro("scout remove telegram");

  const auth = await readAuthFile(DEFAULT_AUTH_PATH);
  if (!auth.telegram?.token) {
    outro("No telegram connector configured.");
    return;
  }

  if (!options.force) {
    const confirmed = await confirm({
      message: "Remove Telegram connector?",
      initialValue: false
    });

    if (isCancel(confirmed) || confirmed === false) {
      outro("Canceled.");
      return;
    }
  }

  await removeTelegramAuth();
  outro("Removed Telegram connector.");
}
