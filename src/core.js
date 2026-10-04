import { acceptsMessage, hasPermission, isOwner } from "./permissions.js";
import { codeBox, codeText, fields, reply, wrapText } from "./messages.js";
import { parseSkillCommand, skillNamespace } from "./commands.js";

const MAIN_COMMANDS = [
  {
    command: "!help [skill]",
    description: "Visa huvudbotens och laddade skills kommandon.",
    permission: "help",
  },
  {
    command: "!info",
    description: "Visa botens version och laddade skills.",
    ownerOnly: true,
  },
  {
    command: "!skills",
    description: "Lista tillgängliga skills och vilka som är aktiva.",
    ownerOnly: true,
  },
];

function commandList(entries, userId, config) {
  const width = Math.max(
    "Kommando".length,
    ...entries.map((entry) => entry.command.length),
  );
  const lines = [
    `${"Kommando".padEnd(width)}  Åtkomst`,
    `${"─".repeat(width)}  ${"─".repeat(17)}`,
  ];
  for (const entry of entries) {
    const access = entry.ownerOnly
      ? "endast ägare"
      : entry.permission
        ? hasPermission(userId, entry.permission, config)
          ? "tillåtet"
          : "kräver behörighet"
        : "alla";
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
        await reply(message, "Du har inte behörighet att använda kommandot.");
        return;
      }
      if (mainHelp && args.length && !selected) {
        await reply(
          message,
          "Ingen laddad skill med det namnet. Använd !help för att se tillgängliga kommandon.",
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
              "Denna skill har ingen registrerad kommandohjälp.",
            );
      if (selected) {
        await reply(message, skillHelp(selected));
        return;
      }
      const lines = [
        "**SkillsBot – kommandon**",
        section("Huvudbot", MAIN_COMMANDS),
      ];
      for (const skill of client.skills.values()) {
        lines.push(skillHelp(skill));
      }
      if (!client.skills.size)
        lines.push(codeBox("Skills", "Inga skills är laddade."));
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
            ["Laddade skills", names.join(", ") || "(inga)"],
          ]),
        ),
      );
    } catch {
      console.error("Could not send bot information to Discord.");
    }
  });
}
