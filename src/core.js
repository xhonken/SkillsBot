import { acceptsMessage, hasPermission, isOwner } from "./permissions.js";
import { codeBox, codeText, fields, reply, wrapText } from "./messages.js";
import { parseSkillCommand, skillNamespace } from "./commands.js";

const MAIN_COMMANDS = [
  {
    command: "!help [skill]",
    description: "Show main-bot and loaded-skill commands.",
    permission: "help",
  },
  {
    command: "!info",
    description: "Show the bot version and loaded skills.",
    ownerOnly: true,
  },
  {
    command: "!skills",
    description: "List available skills and their current status.",
    ownerOnly: true,
  },
];

function commandList(entries, userId, config) {
  const width = Math.max(
    "Command".length,
    ...entries.map((entry) => entry.command.length),
  );
  const lines = [
    `${"Command".padEnd(width)}  Access`,
    `${"─".repeat(width)}  ${"─".repeat(17)}`,
  ];
  for (const entry of entries) {
    const access = entry.ownerOnly
      ? "owners only"
      : entry.permission
        ? hasPermission(userId, entry.permission, config)
          ? "allowed"
          : "permission required"
        : "everyone";
    lines.push(
      `${codeText(entry.command).padEnd(width)}  ${access}`,
      ...wrapText(entry.description, 62).map((line) => `  ${line}`),
      "",
    );
  }
  return lines.join("\n");
}

export function registerHelp(client, config) {
  client.on("messageCreate", async (message) => {
    if (!acceptsMessage(message, config)) return;
    const [prefix, ...args] = message.content.trim().toLowerCase().split(/\s+/);
    const mainHelp = prefix === "!help";
    let selected;
    if (mainHelp) {
      if (args.length > 1) return;
      if (args.length)
        selected = [...client.skills.values()].find(
          (skill) =>
            args[0] === skill.name || args[0] === skillNamespace(skill),
        );
    } else {
      selected = [...client.skills.values()].find((skill) => {
        const parsed = parseSkillCommand(
          message.content,
          skillNamespace(skill),
        );
        return parsed?.command === "help" && !parsed.args.length;
      });
      if (!selected) return;
    }
    try {
      if (
        !hasPermission(message.author.id, "help", config) ||
        (selected &&
          !hasPermission(
            message.author.id,
            `${skillNamespace(selected)}.help`,
            config,
          ))
      ) {
        await reply(message, "You do not have permission to use this command.");
        return;
      }
      if (mainHelp && args.length && !selected) {
        await reply(
          message,
          "No loaded skill has that name. Use !help to see available commands.",
        );
        return;
      }
      const section = (title, entries) =>
        codeBox(title, commandList(entries, message.author.id, config));
      const skillHelp = (skill) =>
        skill.commands?.length
          ? section(
              `Skill: ${skill.name} (!${skillNamespace(skill)})`,
              skill.commands,
            )
          : codeBox(
              `Skill: ${skill.name} (!${skillNamespace(skill)})`,
              "This skill has no registered command help.",
            );
      if (selected) {
        await reply(message, skillHelp(selected));
        return;
      }
      const lines = [
        "**SkillsBot – commands**",
        section("Main bot", MAIN_COMMANDS),
      ];
      for (const skill of client.skills.values()) {
        lines.push(skillHelp(skill));
      }
      if (!client.skills.size)
        lines.push(codeBox("Skills", "No skills are loaded."));
      await reply(message, lines.join("\n\n"));
    } catch {
      console.error("Could not send bot help to Discord.");
    }
  });
}

export function registerInfo(client, config, version) {
  client.on("messageCreate", async (message) => {
    if (
      !acceptsMessage(message, config) ||
      message.content.trim().toLowerCase() !== "!info" ||
      !isOwner(message.author.id, config)
    )
      return;
    const names = [...client.skills.values()].map((skill) => skill.name);
    try {
      await reply(
        message,
        codeBox(
          "SkillsBot",
          fields([
            ["Version", `v${version}`],
            ["Loaded skills", names.join(", ") || "(none)"],
          ]),
        ),
      );
    } catch {
      console.error("Could not send bot information to Discord.");
    }
  });
}
