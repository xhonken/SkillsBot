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
  const host = options.host || (await prompt("Printer IP address: "));
  if (!/^[a-zA-Z0-9.-]+$/.test(host))
    throw new StatusError("Enter a valid IP address or hostname.");
  log("Fetching printer name and serial number…");
  const found = await discover(host, { deviceId: options.serial });
  const deviceId =
    options.serial ||
    found?.deviceId ||
    (await prompt("Serial number (could not be discovered automatically): "));
  const previousEntry = Object.entries(config.printers).find(
    ([, p]) => p.protocol === "bambu" && p.deviceId === deviceId,
  );
  const previous = previousEntry?.[1];
  if (found?.displayName) log(`Found ${found.displayName}.`);
  else log("The name could not be discovered automatically.");
  const displayName =
    options.name ||
    (!found?.displayName
      ? (await prompt(
          `Printer name${previous?.displayName ? ` [${previous.displayName}]` : ""}: `,
        )) || previous?.displayName
      : undefined);
  const accessCode = await prompt("LAN access code (hidden input): ", {
    hidden: true,
  });
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(accessCode))
    throw new StatusError("Enter the printer LAN access code.");
  log("Checking connection and fetching model, firmware, and AMS…");
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
      "The printer ID maps to another printer's environment variable; choose a different ID with --id.",
    );
  const group =
    options.group !== undefined
      ? options.group.toLowerCase()
      : (
          await prompt("Group (Enter = keep existing groups or standalone): ")
        ).toLowerCase();
  const printer = { ...result.printer, passwordEnv: key };
  await save([{ id, printer, previous, group }], {
    configPath: options.configPath,
    envPath: options.envPath,
    credential: { key, code: accessCode },
  });
  log(
    `Saved: ${printer.displayName} (${id}), ${printer.ams.length} AMS unit(s).`,
  );
  log(
    `Try !3d status ${id} and !3d ams ${id} in Discord after enabling the printer skill in config.json and restarting if needed.`,
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
      "Add a Bambu printer: npm run printer:add\nEnter IP and LAN access code. Name, serial, and AMS are discovered when available.\nOptional: -- --host <IP> --serial <serial> --name <name> --id <id> --group <group>\nThe LAN access code is entered privately in the terminal, never as a command-line argument.",
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
        : "The printer could not be saved. Check configuration with npm run check and retry.",
    );
    process.exitCode = 1;
  });
