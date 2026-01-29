import { Command } from "commander";
import { addClaudeCodeCommand } from "./commands/add-claude-code.js";
import { addCodexCommand } from "./commands/add-codex.js";
import { addTelegramCommand } from "./commands/add-telegram.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { initLogging } from "./log.js";

const program = new Command();

initLogging();

program
  .name("scout")
  .description("Personal AI agent")
  .version("0.0.0");

program
  .command("start")
  .description("Launch the scout bot")
  .option(
    "-c, --config <path>",
    "Path to config file",
    ".scout/scout.config.json"
  )
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
  .action(addTelegramCommand);

addCommand
  .command("codex")
  .description("Add Codex token")
  .option("-t, --token <token>", "Codex token")
  .option("-m, --model <id>", "Codex model id")
  .option("--main", "Set Codex as the primary model")
  .action(addCodexCommand);

addCommand
  .command("claude")
  .description("Add Claude Code token")
  .option("-t, --token <token>", "Claude Code token")
  .option("-m, --model <id>", "Claude Code model id")
  .option("--main", "Set Claude Code as the primary model")
  .action(addClaudeCodeCommand);

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

await program.parseAsync(process.argv);
