import { confirm, intro, isCancel, outro, password } from "@clack/prompts";
import { DEFAULT_AUTH_PATH, readAuthFile, writeAuthFile } from "../auth.js";

export type AddTelegramOptions = {
  token?: string;
};

export async function addTelegramCommand(
  options: AddTelegramOptions
): Promise<void> {
  intro("scout add telegram");

  const tokenInput =
    options.token ??
    (await password({
      message: "Telegram bot token",
      validate: (value) => (value ? undefined : "Token is required")
    }));

  if (isCancel(tokenInput)) {
    outro("Canceled.");
    return;
  }

  const token = String(tokenInput);

  const auth = await readAuthFile(DEFAULT_AUTH_PATH);

  if (auth.telegram?.token) {
    const overwrite = await confirm({
      message: `Overwrite existing telegram token in ${DEFAULT_AUTH_PATH}?`,
      initialValue: false
    });

    if (isCancel(overwrite) || overwrite === false) {
      outro("Canceled.");
      return;
    }
  }

  auth.telegram = { token };
  await writeAuthFile(DEFAULT_AUTH_PATH, auth);

  outro(`Saved telegram token to ${DEFAULT_AUTH_PATH}`);
}
