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
    description: "Visa skrivarskillens kommandon.",
    permission: "3d.help",
  },
  {
    command: "!3d status <skrivare|grupp|all>",
    description: "Visa utskriftsstatus, framsteg, tid kvar och fel.",
    permission: "3d.status",
  },
  {
    command: "!3d ams <skrivare|grupp|all>",
    description: "Visa AMS-fack, filament, färger och mängd kvar.",
    permission: "3d.ams",
  },
  {
    command: "!3d printers [skrivare|grupp|all]",
    description:
      "Lista skrivare och grupper, eller visa en vald skrivares uppgifter.",
    permission: "3d.printers",
  },
  {
    command: "!3d brands",
    description: "Lista skrivarmärken och anslutningar.",
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
          "Okänt skrivarkommando. Använd !3d help för att se kommandona.",
        );
        return;
      }
      if (
        !hasPermission(message.author.id, `${namespace}.${command}`, config)
      ) {
        await reply(message, "Du har inte behörighet att använda kommandot.");
        return;
      }
      if (command === "brands") {
        await reply(
          message,
          [
            codeBox(
              "Märken",
              table(
                [
                  { label: "ID", maxWidth: 16 },
                  { label: "Märke", maxWidth: 24 },
                ],
                Object.entries(BRANDS),
              ),
            ),
            codeBox(
              "Anslutningar",
              table(
                [{ label: "Protokoll" }, { label: "API" }],
                [
                  ["bambu", "Bambu MQTT"],
                  ["moonraker", "Moonraker"],
                  ["octoprint", "OctoPrint"],
                  ["prusalink", "PrusaLink"],
                ],
              ) +
                "\n\n" +
                wrapText(
                  "Modellen måste ha ett av dessa API:er; märkesnamnet räcker inte. Voron är ett byggprojekt.",
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
        await reply(message, "Vänta några sekunder innan nästa skrivarfråga.");
        return;
      }
      requests.set(requestKey, now + cooldownMs);
      let printers;
      try {
        printers = await service.load();
      } catch {
        await reply(
          message,
          "Skrivarkonfigurationen kunde inte läsas. Kontrollera `printers.json` med `npm run check`.",
        );
        return;
      }
      if (command === "printers") {
        if (args.length > 1) {
          await reply(
            message,
            "Använd !3d printers <skrivare|grupp|all> eller !3d printers för hela listan.",
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
            "Ingen skrivare eller grupp med det namnet hittades. Använd !3d printers för att se giltiga ID:n.",
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
            p.enabled === false ? "avstängd" : "aktiv",
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
              "Skrivare",
              rows.length
                ? table(
                    [
                      { label: "ID", maxWidth: 48 },
                      { label: "Namn", maxWidth: 24 },
                      { label: "Märke", maxWidth: 16 },
                      { label: "Anslutning" },
                      { label: "Status" },
                    ],
                    rows,
                  )
                : "Inga skrivare är konfigurerade ännu.",
            ),
            codeBox(
              "Grupper",
              groups.length
                ? table(
                    [
                      { label: "Grupp", maxWidth: 48 },
                      { label: "Skrivare", maxWidth: 48 },
                    ],
                    groups,
                  )
                : "Inga grupper för de valda skrivarna.",
            ),
            ...(Object.hasOwn(printers.printers, target)
              ? [
                  codeBox(
                    "Skrivaruppgifter",
                    fields([
                      ["Modell", printers.printers[target].model || "Okänd"],
                      [
                        "Firmware",
                        printers.printers[target].firmwareVersion || "Okänd",
                      ],
                      [
                        "AMS-enheter",
                        Array.isArray(printers.printers[target].ams)
                          ? String(printers.printers[target].ams.length)
                          : "Okänt",
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
        await reply(
          message,
          "Ange ett skrivarnamn, ett gruppnamn eller `all`.",
        );
        return;
      }
      const target = (args[0] || "all").toLowerCase();
      const names = resolveTarget(printers, target);
      if (!names.length) {
        await reply(
          message,
          target === "all"
            ? "Inga aktiva skrivare är konfigurerade."
            : `Ingen skrivare eller grupp med namnet ${safeText(target)} hittades.`,
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
                "AMS stöds endast via Bambu-anslutningen.",
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
