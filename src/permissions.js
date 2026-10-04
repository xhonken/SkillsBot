import { readBotConfig } from "./config.js";

let config = { owners: [], channelIds: [], permissions: {} };

export async function loadConfig(path) {
  config = await readBotConfig(path);
  return config;
}

export function isOwner(userId, settings = config) {
  return settings.owners.includes(userId);
}

export function hasPermission(userId, key, settings = config) {
  if (isOwner(userId, settings)) return true;
  if (key === "info") return false;
  if (Object.hasOwn(settings.permissions, key)) {
    const allowed = settings.permissions[key];
    return (
      Array.isArray(allowed) &&
      (allowed.length === 0 || allowed.includes(userId))
    );
  }
  return (
    [
      "help",
      "ai.info",
      "3d.help",
      "3d.status",
      "3d.ams",
      "3d.printers",
      "3d.brands",
    ].includes(key) || key.endsWith(".help")
  );
}

export function acceptsMessage(message, settings = config) {
  return (
    !message.author.bot &&
    Boolean(message.guildId) &&
    (!settings.channelIds.length ||
      settings.channelIds.includes(message.channelId))
  );
}
