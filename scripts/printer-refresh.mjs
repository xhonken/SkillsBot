import { readPrinterConfig, readPrinterEnv } from "../src/config.js";
import { inspectBambu, savePrinters } from "../src/printers/onboarding.js";
import { StatusError } from "../src/printers/status.js";

try {
  const config = await readPrinterConfig();
  const env = await readPrinterEnv();
  const updates = [];
  for (const [id, printer] of Object.entries(config.printers)) {
    if (printer.protocol !== "bambu" || printer.enabled === false) continue;
    console.log(`Hämtar namn, modell, firmware och AMS för ${id}…`);
    const result = await inspectBambu(printer, { env });
    updates.push({ id, printer: result.printer, previous: printer });
  }
  if (updates.length) {
    await savePrinters(updates);
    for (const { id, printer } of updates)
      console.log(
        `${id}: ${printer.displayName}, ${printer.ams.length} AMS-enhet(er).`,
      );
    console.log(
      "Uppdaterat. Grupper och skrivar-ID:n är kvar; buffertar och fläktar sparas inte. Ingen omstart behövs.",
    );
  } else console.log("Inga aktiva Bambu-skrivare att uppdatera.");
} catch (error) {
  console.error(
    error instanceof StatusError
      ? error.message
      : "Skrivarkonfigurationen kunde inte uppdateras. Kontrollera filerna med npm run check.",
  );
  process.exitCode = 1;
}
