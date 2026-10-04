import { readBotConfig, readPrinterConfig } from "../src/config.js";
import { discoverSkills } from "../src/skill-manager.js";
import { createAIService } from "../src/ai/service.js";

try {
  const bot = await readBotConfig();
  const printers = await readPrinterConfig();
  const available = await discoverSkills();
  for (const name of bot.skills) {
    if (!available.has(name))
      throw new Error(`Configured skill ${name} is missing from src/skills/.`);
  }
  console.log(
    `Configuration valid: ${bot.owners.length} owner(s), ${Object.keys(printers.printers).length} printer(s), ${Object.keys(printers.groups).length} group(s).`,
  );
  if (!bot.owners.length)
    console.log("Before starting: configure at least one owner Discord ID.");
  console.log(`Selected skills: ${bot.skills.join(", ") || "(none)"}.`);
  if (bot.skills.includes("ai")) {
    const { settings, profile, apiKey } = await createAIService().load();
    console.log(
      profile
        ? `AI profile: ${settings.active}; provider: ${profile.provider}; model: ${profile.model}.`
        : "AI skill: no profile selected. Configure ai.json before asking questions.",
    );
    if (profile?.apiKeyEnv && !apiKey)
      console.log(
        "AI profile: set its API key in the private .env file before querying.",
      );
  }
  for (const [id, printer] of Object.entries(printers.printers)) {
    if (printer.enabled === false) continue;
    for (const key of ["apiKeyEnv", "passwordEnv"]) {
      if (printer[key] && !process.env[printer[key]])
        console.log(
          `Printer ${id}: set environment variable ${printer[key]} before querying.`,
        );
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
