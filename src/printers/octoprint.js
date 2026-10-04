import { getJson } from "./http.js";
import { StatusError, percentage, seconds, state, status } from "./status.js";

export function parseOctoprint(data) {
  if (typeof data.state !== "string")
    throw new StatusError("OctoPrint is missing printer status.");
  const printerState = state(data.state);
  return status({
    state: printerState,
    percentage: percentage(data.progress?.completion),
    remainingSeconds: seconds(data.progress?.printTimeLeft),
    error:
      data.error ||
      (printerState === "error"
        ? "OctoPrint reports an error without a message."
        : null),
  });
}

export async function fetchOctoprint(printer, options) {
  return parseOctoprint(await getJson(printer, "/api/job", options));
}
