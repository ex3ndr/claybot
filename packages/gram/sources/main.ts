import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { initLogging } from "./log.js";
import { loadPluginCommand, unloadPluginCommand } from "./commands/plugins.js";
import { setSecretCommand } from "./commands/secrets.js";

const program = new Command();

initLogging();

program
  .name("gram")
  .description("Personal AI agent")
  .version("0.0.0");

program
  .command("start")
  .description("Launch the gram bot")
  .option(
    "-s, --settings <path>",
    "Path to settings file",
    ".scout/settings.json"
  )
  .action(startCommand);

program
  .command("status")
  .description("Show bot status")
  .action(statusCommand);

const pluginCommand = program.command("plugins").description("Manage plugins");

pluginCommand
  .command("load")
  .description("Load a plugin")
  .argument("<pluginId>", "Plugin id")
  .argument("[instanceId]", "Instance id (defaults to plugin id)")
  .action(loadPluginCommand);

pluginCommand
  .command("unload")
  .description("Unload a plugin")
  .argument("<instanceId>", "Plugin instance id")
  .action(unloadPluginCommand);

const secretsCommand = program.command("secrets").description("Manage secrets");

secretsCommand
  .command("set")
  .description("Set a plugin secret")
  .argument("<plugin>", "Plugin instance id")
  .argument("<key>", "Secret key")
  .argument("<value>", "Secret value")
  .action(setSecretCommand);

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

await program.parseAsync(process.argv);
