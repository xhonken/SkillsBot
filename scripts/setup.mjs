import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { ROOT, validateBotConfig } from "../src/config.js";
import { ask, PromptError } from "../src/terminal.js";

export class SetupError extends Error {}

export async function initializeFiles(root = ROOT) {
  const examples = {
    "config.json":
      JSON.stringify(
        { owners: [], channelIds: [], skills: [], permissions: {} },
        null,
        2,
      ) + "\n",
    "printers.json": '{\n  "printers": {},\n  "groups": {}\n}\n',
    "ai.json": await readFile(new URL("../ai.example.json", import.meta.url)),
    ".env": "# Local credentials; never share this file.\nDISCORD_TOKEN=\n",
  };
  const created = [];
  for (const [name, content] of Object.entries(examples)) {
    try {
      await writeFile(join(root, name), content, { flag: "wx", mode: 0o600 });
      created.push(name);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return created;
}

function discordIDs(answer, label) {
  const values = answer.split(/[,\s]+/).filter(Boolean);
  if (values.some((id) => !/^\d{17,20}$/.test(id)))
    throw new SetupError(label + ": paste full Discord IDs (17–20 digits).");
  return [...new Set(values)];
}

function tokenValue(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._-]{20,4096}$/.test(value) &&
    !value.startsWith("replace-with-")
  );
}

function withToken(content, token) {
  const line = "DISCORD_TOKEN=" + token;
  const pattern = /^[ \t]*(?:export[ \t]+)?DISCORD_TOKEN[ \t]*=.*$/gm;
  return pattern.test(content)
    ? content.replace(pattern, () => line)
    : content + (content && !content.endsWith("\n") ? "\n" : "") + line + "\n";
}

async function atomicWrite(path, content) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function setupBot(
  root = ROOT,
  { prompt = ask, log = console.log } = {},
) {
  await initializeFiles(root);
  const configPath = join(root, "config.json");
  const envPath = join(root, ".env");
  const originalConfig = await readFile(configPath, "utf8");
  const originalEnv = await readFile(envPath, "utf8");
  const config = JSON.parse(originalConfig);
  const previous = validateBotConfig(config);
  const env = parseEnv(originalEnv);
  if (/[\r\n]/.test(env.DISCORD_TOKEN ?? ""))
    throw new SetupError(
      "Remove the multiline DISCORD_TOKEN value before setup.",
    );
  log("SkillsBot setup — token input is hidden. Press Ctrl+C to cancel.");
  const enteredToken = await prompt(
    tokenValue(env.DISCORD_TOKEN)
      ? "Discord bot token (Enter = keep existing): "
      : "Discord bot token: ",
    { hidden: true },
  );
  const token = enteredToken || env.DISCORD_TOKEN;
  if (!tokenValue(token))
    throw new SetupError(
      "Paste a bot token from the Discord Developer Portal.",
    );
  const ownersAnswer = await prompt(
    "Owner user IDs, comma separated" +
      (previous.owners.length ? " (Enter = keep existing)" : "") +
      ": ",
  );
  const owners = ownersAnswer
    ? discordIDs(ownersAnswer, "Owners")
    : previous.owners;
  if (!owners.length)
    throw new SetupError("At least one owner user ID is required.");
  const channelsAnswer = await prompt(
    "Allowed channel IDs (Enter = keep existing; all = all server channels): ",
  );
  const channelIds =
    channelsAnswer.toLowerCase() === "all"
      ? []
      : channelsAnswer
        ? discordIDs(channelsAnswer, "Channels")
        : previous.channelIds;
  const next = { ...config, owners, channelIds, skills: previous.skills };
  validateBotConfig(next);
  const lockPath = join(root, ".setup.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new SetupError(
        "Another setup is saving settings. Try again later.",
      );
    throw error;
  }
  try {
    if (
      (await readFile(configPath, "utf8")) !== originalConfig ||
      (await readFile(envPath, "utf8")) !== originalEnv
    )
      throw new SetupError(
        "Settings changed during setup. Run the guide again.",
      );
    const backup = join(
      root,
      ".backups",
      "setup-" + Date.now() + "-" + randomUUID(),
    );
    await mkdir(backup, { recursive: true, mode: 0o700 });
    await writeFile(join(backup, "config.json"), originalConfig, {
      mode: 0o600,
    });
    await writeFile(join(backup, ".env"), originalEnv, { mode: 0o600 });
    await atomicWrite(envPath, withToken(originalEnv, token));
    try {
      await atomicWrite(configPath, JSON.stringify(next, null, 2) + "\n");
    } catch (error) {
      await atomicWrite(envPath, originalEnv);
      throw error;
    }
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
  log("Saved private settings. No printer or AI configuration was replaced.");
  log(
    "Enable skills manually in config.json, then restart the bot. See docs/GETTING_STARTED.md.",
  );
  log("Next: npm run check, then npm start. Try !help and !info in Discord.");
  return next;
}

async function main() {
  const { values } = parseArgs({
    options: {
      init: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "npm run setup — configure token, owners and channels; preserve skill selection.\n" +
        "npm run setup -- --init — create missing private files only; no prompts.\n" +
        "Stop the bot before reconfiguring. Existing files are preserved by --init.",
    );
    return;
  }
  if (values.init) {
    const files = await initializeFiles();
    console.log(
      files.length
        ? "Created: " + files.join(", ")
        : "All files already exist.",
    );
    return;
  }
  await setupBot();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      error instanceof SetupError || error instanceof PromptError
        ? error.message
        : "Setup failed. Check your local files and permissions, then retry.",
    );
    process.exitCode = 1;
  });
