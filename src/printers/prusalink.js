import { getJson } from "./http.js";
import { StatusError, percentage, seconds, state, status } from "./status.js";

export function parsePrusalink(data) {
  if (typeof data.printer?.state !== "string")
    throw new StatusError("PrusaLink is missing printer status.");
  const printerState = state(data.printer.state);
  const messages = [data.printer.status_printer, data.printer.status_connect]
    .filter((item) => item?.ok === false && item.message)
    .map((item) => item.message);
  if (data.printer.message) messages.push(data.printer.message);
  if (data.printer.error) messages.push(data.printer.error);
  return status({
    state: printerState,
    percentage: percentage(data.job?.progress),
    remainingSeconds: seconds(data.job?.time_remaining),
    error:
      messages.join("; ") ||
      (["error", "attention"].includes(printerState)
        ? "PrusaLink reports an error without a message."
        : null),
  });
}

export async function fetchPrusalink(printer, options) {
  return parsePrusalink(await getJson(printer, "/api/v1/status", options));
}
