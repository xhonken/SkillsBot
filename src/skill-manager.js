import { readdir } from "node:fs/promises";
import { extname, basename } from "node:path";
import { acceptsMessage, isOwner } from "./permissions.js";
import { codeBox, fields, reply, table } from "./messages.js";
import {
  CORE_NAMESPACES,
  parseSkillCommand,
  skillNamespace,
} from "./commands.js";

export class SkillError extends Error {}

const directory = new URL("./skills/", import.meta.url);

export async function discoverSkills() {
  const files = await readdir(directory, { withFileTypes: true });
  const available = new Map();
  for (const file of files) {
    if (!file.isFile() || ![".js", ".mjs"].includes(extname(file.name)))
      continue;
    const name = basename(file.name, extname(file.name));
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) continue;
    if (available.has(name))
      throw new SkillError(`Multiple modules have the name ${name}.`);
    available.set(name, new URL(file.name, directory));
  }
  return available;
}

function snapshot(client) {
  return new Map(
    client
      .eventNames()
      .map((event) => [event, new Set(client.rawListeners(event))]),
  );
}

function addedListeners(client, before) {
  const added = [];
  for (const event of client.eventNames()) {
    for (const listener of client.rawListeners(event)) {
      if (!before.get(event)?.has(listener)) added.push([event, listener]);
    }
  }
  return added;
}

export class SkillManager {
  constructor(
    client,
    config,
    { discover = discoverSkills, load = (url) => import(url) } = {},
  ) {
    this.client = client;
    this.config = config;
    this.discover = discover;
    this.load = load;
    this.cleanup = new Map();
  }

  async start() {
    try {
      for (const name of this.config.skills) await this.activate(name);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async activate(name) {
    if (this.client.skills.has(name)) return false;
    const available = await this.discover();
    if (!available.has(name))
      throw new SkillError(`Skill ${name} is not present in src/skills/.`);
    let skill;
    try {
      ({ default: skill } = await this.load(available.get(name)));
    } catch {
      throw new SkillError(
        `Skill ${name} could not be imported; check its code and dependencies.`,
      );
    }
    if (skill?.name !== name || typeof skill.register !== "function")
      throw new SkillError(
        `Skill ${name} must export a matching name and a register function.`,
      );
    if (
      skill.commands !== undefined &&
      (!Array.isArray(skill.commands) ||
        skill.commands.some(
          (entry) =>
            !entry ||
            typeof entry.command !== "string" ||
            !/^![a-z0-9][a-z0-9_-]*(?: [^`@\u0000-\u001f\u007f]+)?$/i.test(
              entry.command,
            ) ||
            entry.command.length > 160 ||
            typeof entry.description !== "string" ||
            !entry.description.trim() ||
            entry.description.length > 350 ||
            /[\u0000-\u001f\u007f]/.test(entry.description) ||
            (entry.permission !== undefined &&
              (typeof entry.permission !== "string" ||
                !entry.permission.trim())) ||
            (entry.ownerOnly !== undefined &&
              typeof entry.ownerOnly !== "boolean"),
        ))
    )
      throw new SkillError(
        `Skill ${name} has invalid command help. commands must be a list with single-line command and description values.`,
      );
    const namespace = skillNamespace(skill);
    if (
      typeof namespace !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(namespace) ||
      CORE_NAMESPACES.includes(namespace)
    )
      throw new SkillError(
        `Skill ${name} has a reserved or invalid command prefix.`,
      );
    if (
      [...this.client.skills.values()].some(
        (loaded) => skillNamespace(loaded) === namespace,
      )
    )
      throw new SkillError(
        `Command prefix !${namespace} is already used by a loaded skill.`,
      );
    if (
      skill.commands?.some(
        (entry) =>
          !new RegExp(`^!${namespace}(?: |$)`, "i").test(entry.command),
      )
    )
      throw new SkillError(
        `Skill ${name}: all commands must start with !${namespace}.`,
      );
    if (
      skill.commands?.some(
        (entry) =>
          entry.permission !== undefined &&
          !entry.permission.startsWith(`${namespace}.`),
      )
    )
      throw new SkillError(
        `Skill ${name}: permission keys must start with ${namespace}.`,
      );
    const before = snapshot(this.client);
    let cleanup;
    try {
      const result = await skill.register(this.client, {
        config: this.config,
        namespace,
      });
      cleanup =
        typeof result === "function"
          ? result
          : typeof skill.unregister === "function"
            ? () => skill.unregister(this.client)
            : null;
      if (!cleanup)
        throw new SkillError(
          `Skill ${name} must return a cleanup function or provide unregister(client).`,
        );
    } catch (error) {
      for (const [event, listener] of addedListeners(this.client, before))
        this.client.off(event, listener);
      throw error instanceof SkillError
        ? error
        : new SkillError(`Skill ${name} could not be registered.`);
    }
    const listeners = addedListeners(this.client, before).map(
      ([event, listener]) => {
        if (event !== "messageCreate") return [event, listener];
        this.client.off(event, listener);
        const scoped = (message, ...args) => {
          const parsed = parseSkillCommand(message?.content, namespace);
          // The main bot supplies help for every active namespace.
          if (!parsed || parsed.command === "help") return;
          if (listener.listener) this.client.off(event, scoped);
          return listener.call(this.client, message, ...args);
        };
        this.client.on(event, scoped);
        return [event, scoped];
      },
    );
    const dispose = async () => {
      try {
        await cleanup();
      } finally {
        for (const [event, listener] of listeners)
          this.client.off(event, listener);
      }
    };
    this.cleanup.set(name, dispose);
    this.client.skills.set(name, { ...skill, namespace });
    return true;
  }

  async stop() {
    for (const [name, cleanup] of this.cleanup) {
      try {
        await cleanup();
      } catch {
        console.error(`Cleanup failed for skill ${name}.`);
      }
      this.client.skills.delete(name);
    }
    this.cleanup.clear();
  }
}

export function registerSkillListing(client, config, manager) {
  client.on("messageCreate", async (message) => {
    if (
      !acceptsMessage(message, config) ||
      !isOwner(message.author.id, config) ||
      message.content.trim().toLowerCase() !== "!skills"
    )
      return;
    try {
      const available = await manager.discover();
      const rows = [...available.keys()]
        .sort()
        .map((name) => [
          name,
          client.skills.has(name) ? "enabled" : "disabled",
          client.skills.has(name)
            ? `!${skillNamespace(client.skills.get(name))}`
            : "—",
        ]);
      await reply(
        message,
        codeBox(
          "Skills",
          [
            rows.length
              ? table(
                  [
                    { label: "Skill", maxWidth: 48 },
                    { label: "Status" },
                    { label: "Prefix" },
                  ],
                  rows,
                )
              : "No skill modules were found.",
            "",
            fields([
              [
                "Configuration",
                "Edit the skills list manually in config.json.",
              ],
              ["Restart", "Restart the bot to apply changes."],
            ]),
          ].join("\n"),
        ),
      );
    } catch {
      try {
        await reply(message, "Could not list skills. Check src/skills/.");
      } catch {
        console.error("Could not send skill listing to Discord.");
      }
    }
  });
}
