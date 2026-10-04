import { BRANDS } from "../config.js";
import { acceptsMessage, hasPermission } from "../permissions.js";
import {
  codeBox,
  fields,
  reply as sendReply,
  safeText,
  table,
  wrapText,
} from "../messages.js";
import { createPrinterService, resolveTarget } from "../printers/service.js";
import { formatStatus, formatAMS } from "../printers/format.js";
import { parseSkillCommand } from "../commands.js";

const namespace = "3d";

const commands = [
  {
    command: "!3d help",
    description: "Show printer-skill commands.",
    permission: "3d.help",
  },
  {
    command: "!3d status <printer|group|all>",
    description: "Show print status, progress, time remaining, and errors.",
    permission: "3d.status",
  },
  {
    command: "!3d ams <printer|group|all>",
    description: "Show AMS slots, filament, colors, and remaining amount.",
    permission: "3d.ams",
  },
  {
    command: "!3d printers [printer|group|all]",
    description:
      "List printers and groups, or show a selected printer's details.",
    permission: "3d.printers",
  },
  {
    command: "!3d brands",
    description: "List printer brands and connections.",
    permission: "3d.brands",
  },
];

export function registerPrinterSkill(
  client,
  { config, service = createPrinterService(), cooldownMs = 5000 } = {},
) {
  const requests = new Map();
  let active = true;
  const reply = (message, content, options) =>
    active ? sendReply(message, content, options) : Promise.resolve();
  const onMessage = async (message) => {
    if (!active || !acceptsMessage(message, config)) return;
    const parsed = parseSkillCommand(message.content, namespace);
    if (!parsed || parsed.command === "help") return;
    const { command, args } = parsed;
    try {
      if (!["status", "ams", "printers", "brands"].includes(command)) {
        await reply(
          message,
          "Unknown printer command. Use !3d help to see the commands.",
        );
        return;
      }
      if (
        !hasPermission(message.author.id, `${namespace}.${command}`, config)
      ) {
        await reply(message, "You do not have permission to use this command.");
        return;
      }
      if (command === "brands") {
        await reply(
          message,
          [
            codeBox(
              "Brands",
              table(
                [
                  { label: "ID", maxWidth: 16 },
                  { label: "Brand", maxWidth: 24 },
                ],
                Object.entries(BRANDS),
              ),
            ),
            codeBox(
              "Connections",
              table(
                [{ label: "Protocol" }, { label: "API" }],
                [
                  ["bambu", "Bambu MQTT"],
                  ["moonraker", "Moonraker"],
                  ["octoprint", "OctoPrint"],
                  ["prusalink", "PrusaLink"],
                ],
              ) +
                "\n\n" +
                wrapText(
                  "The model must expose one of these APIs; the brand name alone is insufficient. Voron is a community build project.",
                ).join("\n"),
            ),
          ].join("\n\n"),
        );
        return;
      }
      const now = Date.now();
      for (const [key, expires] of requests)
        if (expires <= now) requests.delete(key);
      const requestKey = `${message.guildId}:${message.author.id}`;
      if (requests.has(requestKey)) {
        await reply(
          message,
          "Wait a few seconds before the next printer query.",
        );
        return;
      }
      requests.set(requestKey, now + cooldownMs);
      let printers;
      try {
        printers = await service.load();
      } catch {
        await reply(
          message,
          "Printer configuration could not be read. Check `printers.json` with `npm run check`.",
        );
        return;
      }
      if (command === "printers") {
        if (args.length > 1) {
          await reply(
            message,
            "Use !3d printers <printer|group|all> or !3d printers for the full list.",
          );
          return;
        }
        const target = (args[0] || "all").toLowerCase();
        const names =
          target === "all"
            ? Object.keys(printers.printers)
            : resolveTarget(printers, target);
        if (target !== "all" && !names.length) {
          await reply(
            message,
            "No printer or group has that name. Use !3d printers to see valid IDs.",
          );
          return;
        }
        const rows = names.map((id) => {
          const p = printers.printers[id];
          return [
            id,
            p.displayName || id,
            BRANDS[p.brand],
            p.protocol,
            p.enabled === false ? "disabled" : "enabled",
          ];
        });
        const groups = Object.entries(printers.groups)
          .filter(([, members]) => members.some((id) => names.includes(id)))
          .map(([id, members]) => [
            id,
            members.filter((member) => names.includes(member)).join(", "),
          ]);
        await reply(
          message,
          [
            codeBox(
              "Printers",
              rows.length
                ? table(
                    [
                      { label: "ID", maxWidth: 48 },
                      { label: "Name", maxWidth: 24 },
                      { label: "Brand", maxWidth: 16 },
                      { label: "Connection" },
                      { label: "Status" },
                    ],
                    rows,
                  )
                : "No printers are configured yet.",
            ),
            codeBox(
              "Groups",
              groups.length
                ? table(
                    [
                      { label: "Group", maxWidth: 48 },
                      { label: "Printers", maxWidth: 48 },
                    ],
                    groups,
                  )
                : "No groups for the selected printers.",
            ),
            ...(Object.hasOwn(printers.printers, target)
              ? [
                  codeBox(
                    "Printer details",
                    fields([
                      ["Model", printers.printers[target].model || "Unknown"],
                      [
                        "Firmware",
                        printers.printers[target].firmwareVersion || "Unknown",
                      ],
                      [
                        "AMS units",
                        Array.isArray(printers.printers[target].ams)
                          ? String(printers.printers[target].ams.length)
                          : "Unknown",
                      ],
                    ]),
                  ),
                ]
              : []),
          ].join("\n\n"),
        );
        return;
      }
      if (args.length > 1) {
        await reply(message, "Enter a printer ID, group ID, or `all`.");
        return;
      }
      const target = (args[0] || "all").toLowerCase();
      const names = resolveTarget(printers, target);
      if (!names.length) {
        await reply(
          message,
          target === "all"
            ? "No enabled printers are configured."
            : `No printer or group named ${safeText(target)} was found.`,
        );
        return;
      }
      const reports = await Promise.all(
        names.map(async (name) => {
          const printer = printers.printers[name];
          const displayName = printer.displayName || name;
          if (command === "ams" && printer.protocol !== "bambu")
            return {
              text: codeBox(
                displayName,
                "AMS is supported only through a Bambu connection.",
              ),
            };
          const status = await service.fetchStatus(printer, command === "ams");
          return command === "ams"
            ? { text: formatAMS(displayName, status) }
            : { text: formatStatus(displayName, status) };
        }),
      );
      if (command !== "ams") {
        await reply(message, reports.map((report) => report.text).join("\n\n"));
        return;
      }
      for (const report of reports) {
        if (!active) return;
        await reply(message, report.text);
      }
    } catch {
      console.error(
        "Printer command failed; check configuration and Discord channel permissions.",
      );
    }
  };
  client.on("messageCreate", onMessage);
  return () => {
    active = false;
    requests.clear();
    client.off("messageCreate", onMessage);
  };
}

export default {
  name: "3dprinter",
  namespace,
  commands,
  register: registerPrinterSkill,
};
