import { readdir } from "node:fs/promises";
import { extname, basename } from "node:path";
import { saveEnabledSkills } from "./config.js";
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
      throw new SkillError(`Flera moduler har namnet ${name}.`);
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
    {
      discover = discoverSkills,
      load = (url) => import(url),
      save = saveEnabledSkills,
    } = {},
  ) {
    this.client = client;
    this.config = config;
    this.discover = discover;
    this.load = load;
    this.save = save;
    this.cleanup = new Map();
    this.queue = Promise.resolve();
  }

  async start() {
    try {
      for (const name of this.config.skills) await this.activate(name, false);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  change(action, name) {
    // Serialize changes so simultaneous owners cannot lose each other's edits.
    const task = this.queue.then(() =>
      action === "add" ? this.activate(name, true) : this.deactivate(name),
    );
    this.queue = task.catch(() => {});
    return task;
  }

  async activate(name, persist) {
    if (this.client.skills.has(name)) return false;
    const available = await this.discover();
    if (!available.has(name))
      throw new SkillError(`Skill ${name} finns inte i src/skills/.`);
    let skill;
    try {
      ({ default: skill } = await this.load(available.get(name)));
    } catch {
      throw new SkillError(
        `Skill ${name} kunde inte importeras; kontrollera modulens kod och beroenden.`,
      );
    }
    if (skill?.name !== name || typeof skill.register !== "function")
      throw new SkillError(
        `Skill ${name} måste exportera samma name som filnamnet och en register-funktion.`,
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
        `Skill ${name} har ogiltig kommandohjälp. commands måste vara en lista med command och description på en rad.`,
      );
    const namespace = skillNamespace(skill);
    if (
      typeof namespace !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(namespace) ||
      CORE_NAMESPACES.includes(namespace)
    )
      throw new SkillError(
        `Skill ${name} har ett reserverat eller ogiltigt kommandoprefix.`,
      );
    if (
      [...this.client.skills.values()].some(
        (loaded) => skillNamespace(loaded) === namespace,
      )
    )
      throw new SkillError(
        `Kommandoprefixet !${namespace} används redan av en laddad skill.`,
      );
    if (
      skill.commands?.some(
        (entry) =>
          !new RegExp(`^!${namespace}(?: |$)`, "i").test(entry.command),
      )
    )
      throw new SkillError(
        `Skill ${name}: alla kommandon måste börja med !${namespace}.`,
      );
    if (
      skill.commands?.some(
        (entry) =>
          entry.permission !== undefined &&
          !entry.permission.startsWith(`${namespace}.`),
      )
    )
      throw new SkillError(
        `Skill ${name}: behörighetsnycklar måste börja med ${namespace}.`,
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
          `Skill ${name} måste returnera en cleanup-funktion eller ha unregister(client).`,
        );
    } catch (error) {
      for (const [event, listener] of addedListeners(this.client, before))
        this.client.off(event, listener);
      throw error instanceof SkillError
        ? error
        : new SkillError(`Skill ${name} kunde inte registreras.`);
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
    const next = [...this.client.skills.keys(), name];
    if (persist) {
      try {
        await this.save(next);
      } catch {
        await dispose();
        throw new SkillError(
          "Kunde inte spara skill-valet i config.json. Ingen skill aktiverades.",
        );
      }
    }
    this.cleanup.set(name, dispose);
    this.client.skills.set(name, { ...skill, namespace });
    if (persist) this.config.skills = next;
    return true;
  }

  async deactivate(name) {
    if (!this.client.skills.has(name)) return false;
    const next = [...this.client.skills.keys()].filter((item) => item !== name);
    try {
      await this.save(next);
    } catch {
      throw new SkillError(
        "Kunde inte spara skill-valet i config.json. Skill är fortfarande aktiv.",
      );
    }
    try {
      await this.cleanup.get(name)();
    } finally {
      this.cleanup.delete(name);
      this.client.skills.delete(name);
      this.config.skills = next;
    }
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

export function registerSkillCommands(client, config, manager) {
  client.on("messageCreate", async (message) => {
    if (!acceptsMessage(message, config) || !isOwner(message.author.id, config))
      return;
    const [command, action, name, ...rest] = message.content
      .trim()
      .toLowerCase()
      .split(/\s+/);
    if (!["!skill", "!skills"].includes(command)) return;
    try {
      if (command === "!skills") {
        const available = await manager.discover();
        const rows = [...available.keys()]
          .sort()
          .map((name) => [
            name,
            client.skills.has(name) ? "aktiv" : "avstängd",
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
                : "Inga skill-moduler hittades.",
              "",
              fields([
                ["Aktivera", "!skill add <namn>"],
                ["Stäng av", "!skill remove <namn>"],
              ]),
            ].join("\n"),
          ),
        );
        return;
      }
      if (
        !["add", "remove"].includes(action) ||
        !name ||
        !/^[a-z0-9][a-z0-9_-]*$/.test(name) ||
        rest.length
      ) {
        await reply(
          message,
          "Använd `!skills`, `!skill add <namn>` eller `!skill remove <namn>`.",
        );
        return;
      }
      const changed = await manager.change(action, name);
      await reply(
        message,
        codeBox(
          "Skill-hantering",
          fields([
            ["Skill", name],
            [
              "Status",
              changed
                ? action === "add"
                  ? "har aktiverats"
                  : "har stängts av"
                : action === "add"
                  ? "är redan aktiv"
                  : "är redan avstängd",
            ],
            ["Sparat", "Valet gäller även efter omstart."],
          ]),
        ),
      );
    } catch (error) {
      try {
        await reply(
          message,
          error instanceof SkillError
            ? error.message
            : "Skill-hanteringen misslyckades. Kontrollera modulens cleanup-funktion.",
        );
      } catch {
        console.error("Could not send skill-management response to Discord.");
      }
    }
  });
}
