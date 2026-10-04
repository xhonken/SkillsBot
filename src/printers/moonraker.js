import { getJson } from "./http.js";
import {
  StatusError,
  number,
  percentage,
  seconds,
  state,
  status,
} from "./status.js";

export function parseMoonraker(data) {
  const objects = data.result?.status;
  if (!objects || typeof objects !== "object")
    throw new StatusError("Moonraker returnerade inget statusobjekt.");
  const hooks = objects.webhooks;
  if (hooks && hooks.state !== "ready") {
    return status({
      state: ["shutdown", "error"].includes(hooks.state) ? "error" : "offline",
      error: hooks.state_message || "Klipper är inte redo.",
    });
  }
  const stats = objects.print_stats;
  if (!stats || typeof stats.state !== "string")
    throw new StatusError(
      "Moonraker saknar print_stats; kontrollera Klipper-konfigurationen.",
    );
  const printerState = state(stats.state);
  const progress =
    number(objects.display_status?.progress) ??
    number(objects.virtual_sdcard?.progress);
  const pct = percentage(progress === null ? null : progress * 100);
  const elapsed = number(stats.print_duration);
  const remaining =
    ["printing", "paused"].includes(printerState) &&
    elapsed !== null &&
    pct !== null &&
    pct > 0
      ? seconds(elapsed * (100 / pct - 1))
      : null;
  return status({
    state: printerState,
    percentage: pct,
    remainingSeconds: remaining,
    estimateSource: remaining !== null ? "progress" : null,
    error:
      printerState === "error"
        ? stats.message || "Klipper rapporterar ett fel utan feltext."
        : null,
  });
}

export async function fetchMoonraker(printer, options) {
  return parseMoonraker(
    await getJson(
      printer,
      "/printer/objects/query?print_stats&virtual_sdcard&display_status&webhooks",
      options,
    ),
  );
}
