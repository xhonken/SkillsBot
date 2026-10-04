import { readBotConfig, readPrinterConfig } from "../src/config.js";

try {
  const config = await readBotConfig();
  if (!config.owners.length)
    throw new Error("Configure at least one owner in config.json.");
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token || token.startsWith("replace-with-"))
    throw new Error("Set DISCORD_TOKEN in the private .env file.");
  if (config.skills.includes("3dprinter")) await readPrinterConfig();
  console.log("SkillsBot startup configuration is ready.");
} catch (error) {
  console.error(`SkillsBot is waiting for configuration: ${error.message}`);
  // systemd ExecCondition treats 1 as a skipped start, without a restart loop.
  process.exitCode = 1;
}
