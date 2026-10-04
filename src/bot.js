import { Client, GatewayIntentBits, Collection } from "discord.js";
import { readFile } from "node:fs/promises";
import { loadConfig } from "./permissions.js";
import { registerHelp, registerInfo } from "./core.js";
import { SkillManager, registerSkillListing } from "./skill-manager.js";

async function main() {
  const config = await loadConfig();
  if (!config.owners.length)
    throw new Error("Add at least one Discord owner ID to config.json.");
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("Missing DISCORD_TOKEN environment variable.");
  const packageInfo = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    allowedMentions: { parse: [], repliedUser: false },
  });
  client.skills = new Collection();
  registerInfo(client, config, packageInfo.version);
  registerHelp(client, config);
  const manager = new SkillManager(client, config);
  await manager.start();
  registerSkillListing(client, config, manager);
  console.log(
    `Loaded skills: ${[...client.skills.keys()].join(", ") || "(none)"}`,
  );
  client.once("ready", () => console.log(`Logged in as ${client.user.tag}`));
  client.on("error", () => console.error("Discord client error."));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await manager.stop();
      client.destroy();
      process.exit(0);
    });
  }
  await client.login(token);
}

main().catch((error) => {
  const message = String(error.message).replaceAll(
    process.env.DISCORD_TOKEN || "\0",
    "[redacted]",
  );
  console.error(`Bot startup failed: ${message}`);
  process.exit(1);
});
