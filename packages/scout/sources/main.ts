import { Command } from "commander";
import { configureTelegramCommand } from "./commands/configure-telegram.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("scout")
  .description("Personal AI agent")
  .version("0.0.0");

program
  .command("start")
  .description("Launch the scout bot")
  .option("-c, --config <path>", "Path to config file", "scout.config.json")
  .action(startCommand);

program
  .command("status")
  .description("Show bot status")
  .action(statusCommand);

program
  .command("configure-telegram")
  .description("Configure Telegram connector")
  .option("-t, --token <token>", "Telegram bot token")
  .option("-o, --output <path>", "Config output path", ".scout/telegram.json")
  .action(configureTelegramCommand);

await program.parseAsync(process.argv);
