import { readPrinterConfig, readPrinterEnv } from "../src/config.js";
import { inspectBambu, savePrinters } from "../src/printers/onboarding.js";
import { StatusError } from "../src/printers/status.js";

try {
  const config = await readPrinterConfig();
  const env = await readPrinterEnv();
  const updates = [];
  for (const [id, printer] of Object.entries(config.printers)) {
    if (printer.protocol !== "bambu" || printer.enabled === false) continue;
    console.log(`Fetching name, model, firmware, and AMS for ${id}…`);
    const result = await inspectBambu(printer, { env });
    updates.push({ id, printer: result.printer, previous: printer });
  }
  if (updates.length) {
    await savePrinters(updates);
    for (const { id, printer } of updates)
      console.log(
        `${id}: ${printer.displayName}, ${printer.ams.length} AMS unit(s).`,
      );
    console.log(
      "Updated. Groups and printer IDs are preserved; buffers and fans are not stored. No restart is needed.",
    );
  } else console.log("No enabled Bambu printers to update.");
} catch (error) {
  console.error(
    error instanceof StatusError
      ? error.message
      : "Printer configuration could not be updated. Check the files with npm run check.",
  );
  process.exitCode = 1;
}
