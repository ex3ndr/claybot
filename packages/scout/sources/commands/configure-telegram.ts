import { confirm, intro, isCancel, outro, password } from "@clack/prompts";
import { promises as fs } from "node:fs";
import path from "node:path";

export type ConfigureTelegramOptions = {
  token?: string;
  output: string;
};

const DEFAULT_OUTPUT = ".scout/telegram.json";

export async function configureTelegramCommand(
  options: ConfigureTelegramOptions
): Promise<void> {
  intro("scout configure telegram");

  const outputPath = path.resolve(options.output || DEFAULT_OUTPUT);

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

  let shouldWrite = true;
  try {
    await fs.stat(outputPath);
    const overwrite = await confirm({
      message: `Overwrite existing config at ${outputPath}?`,
      initialValue: false
    });

    if (isCancel(overwrite) || overwrite === false) {
      shouldWrite = false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (!shouldWrite) {
    outro("Canceled.");
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    JSON.stringify({ token }, null, 2) + "\n",
    { mode: 0o600 }
  );

  outro(`Saved telegram config to ${outputPath}`);
}
