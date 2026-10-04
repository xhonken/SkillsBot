import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { readPrinterConfig, readPrinterEnv } from "../src/config.js";
import { discoverBambu } from "../src/printers/discovery.js";
import {
  inspectBambu,
  printerId,
  savePrinters,
} from "../src/printers/onboarding.js";
import { StatusError } from "../src/printers/status.js";
import { ask, PromptError } from "../src/terminal.js";

export { ask };

export async function addPrinter(
  options = {},
  {
    prompt = ask,
    log = console.log,
    discover = discoverBambu,
    inspect = inspectBambu,
    save = savePrinters,
  } = {},
) {
  const config = await readPrinterConfig(options.configPath);
  const host = options.host || (await prompt("Skrivarens IP-adress: "));
  if (!/^[a-zA-Z0-9.-]+$/.test(host))
    throw new StatusError("Ange en giltig IP-adress eller ett värdnamn.");
  log("Hämtar skrivarens namn och serienummer…");
  const found = await discover(host, { deviceId: options.serial });
  const deviceId =
    options.serial ||
    found?.deviceId ||
    (await prompt("Serienummer (kunde inte hämtas automatiskt): "));
  const previousEntry = Object.entries(config.printers).find(
    ([, p]) => p.protocol === "bambu" && p.deviceId === deviceId,
  );
  const previous = previousEntry?.[1];
  if (found?.displayName) log(`Hittade ${found.displayName}.`);
  else log("Namnet kunde inte hämtas automatiskt.");
  const displayName =
    options.name ||
    (!found?.displayName
      ? (await prompt(
          `Skrivarnamn${previous?.displayName ? ` [${previous.displayName}]` : ""}: `,
        )) || previous?.displayName
      : undefined);
  const accessCode = await prompt("LAN-kod (dold inmatning): ", {
    hidden: true,
  });
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(accessCode))
    throw new StatusError("Ange skrivarens LAN-kod.");
  log("Kontrollerar anslutningen och hämtar modell, firmware och AMS…");
  const result = await inspect(
    { ...previous, host, deviceId },
    {
      discovery: found,
      displayName,
      accessCode,
      env: await readPrinterEnv(options.envPath),
    },
  );
  const id =
    options.id ||
    previousEntry?.[0] ||
    printerId(result.printer.displayName, config);
  const key =
    previous?.passwordEnv ||
    `BAMBU_${id.toUpperCase().replaceAll("-", "_")}_ACCESS_CODE`;
  // Hyphens and underscores can map to the same environment name.
  if (
    Object.entries(config.printers).some(
      ([other, p]) =>
        other !== id && (p.passwordEnv === key || p.apiKeyEnv === key),
    )
  )
    throw new StatusError(
      "Skrivar-ID:t ger samma miljövariabel som en annan skrivare; välj ett annat ID med --id.",
    );
  const group =
    options.group !== undefined
      ? options.group.toLowerCase()
      : (
          await prompt(
            "Grupp (Enter = behåll befintliga grupper eller fristående): ",
          )
        ).toLowerCase();
  const printer = { ...result.printer, passwordEnv: key };
  await save([{ id, printer, previous, group }], {
    configPath: options.configPath,
    envPath: options.envPath,
    credential: { key, code: accessCode },
  });
  log(
    `Sparad: ${printer.displayName} (${id}), ${printer.ams.length} AMS-enhet(er).`,
  );
  log(
    `Testa !3d status ${id} och !3d ams ${id} i Discord. Ingen omstart behövs.`,
  );
  return { id, printer };
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      host: { type: "string" },
      serial: { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      group: { type: "string" },
    },
  });
  if (values.help) {
    console.log(
      "Lägg till en Bambu-skrivare: npm run printer:add\nAnge IP och LAN-kod. Namn, serienummer och AMS hämtas automatiskt.\nValfritt: -- --host <IP> --serial <serienummer> --name <namn> --id <id> --group <grupp>\nLAN-koden anges alltid dolt i terminalen, aldrig som kommandoradsargument.",
    );
    return;
  }
  await addPrinter(values);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      error instanceof StatusError || error instanceof PromptError
        ? error.message
        : "Skrivaren kunde inte sparas. Kontrollera konfigurationen med npm run check och försök igen.",
    );
    process.exitCode = 1;
  });
