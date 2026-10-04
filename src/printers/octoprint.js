import { getJson } from "./http.js";
import { StatusError, percentage, seconds, state, status } from "./status.js";

export function parseOctoprint(data) {
  if (typeof data.state !== "string")
    throw new StatusError("OctoPrint saknar skrivarstatus.");
  const printerState = state(data.state);
  return status({
    state: printerState,
    percentage: percentage(data.progress?.completion),
    remainingSeconds: seconds(data.progress?.printTimeLeft),
    error:
      data.error ||
      (printerState === "error"
        ? "OctoPrint rapporterar ett fel utan feltext."
        : null),
  });
}

export async function fetchOctoprint(printer, options) {
  return parseOctoprint(await getJson(printer, "/api/job", options));
}
