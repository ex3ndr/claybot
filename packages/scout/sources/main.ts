import { Command } from "commander";
import { addTelegramCommand } from "./commands/add-telegram.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { initLogging } from "./logging/index.js";

const program = new Command();

initLogging();

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

const addCommand = program.command("add").description("Add a connector");

addCommand
  .command("telegram")
  .description("Add Telegram connector")
  .option("-t, --token <token>", "Telegram bot token")
  .option("-o, --output <path>", "Config output path", ".scout/telegram.json")
  .action(addTelegramCommand);

await program.parseAsync(process.argv);
