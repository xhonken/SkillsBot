import { codeBox, fields, safeText } from "../messages.js";
import { describeFilamentColor } from "./ams-colors.js";

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return "unknown";
  if (seconds === 0) return "0 min";
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours
    ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`
    : `${minutes} min`;
}

export function formatStatus(name, status) {
  const labels = {
    printing: "Printing",
    paused: "Paused",
    idle: "No active print job",
    completed: "Print completed; no active print job",
    cancelled: "Print stopped; no active print job",
    offline: "Printer is offline",
    unavailable: "Status could not be fetched",
    disabled: "Disabled in configuration",
    error: "Printer reports an error",
    attention: "Printer needs attention",
    unknown: "Unknown status",
    preparing: "Preparing to print",
  };
  const rows = [["Status", labels[status.state] || labels.unknown]];
  if (["printing", "paused"].includes(status.state)) {
    const pct =
      status.percentage === null || status.percentage === undefined
        ? "unknown progress"
        : `${Math.round(status.percentage * 10) / 10}%`;
    rows.push(
      ["Progress", pct],
      ["Time left", duration(status.remainingSeconds)],
    );
    if (status.estimateSource === "progress")
      rows.push(["Estimate source", "estimated from progress"]);
  }
  if (status.error) rows.push(["Error / HMS", status.error]);
  if (status.cached)
    rows.push(["Updated", "fetched within the last 5 seconds"]);
  return codeBox(name, fields(rows));
}

function tableCell(value, width) {
  const text = safeText(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

export function formatAMS(name, status) {
  const title = `**${safeText(name)}**`;
  if (status.state === "unavailable" || status.state === "disabled")
    return formatStatus(name, status);
  if (status.ams === null)
    return codeBox(name, "The printer did not report AMS information.");
  if (!status.ams.length) return codeBox(name, "No AMS units were reported.");
  const lines = [title];
  for (const unit of status.ams) {
    lines.push("```text", `AMS ${tableCell(unit.id, 8)}`);
    if (!unit.trays.length) lines.push("No slots were reported.");
    else
      lines.push(
        "Slot  Filament      Remaining  Color",
        "────  ────────────  ─────────  ──────────────────",
      );
    for (const tray of unit.trays) {
      const empty = tray.present === false;
      const remaining = empty
        ? "–"
        : tray.remainingPercentage === null ||
            tray.remainingPercentage === undefined
          ? "Unknown"
          : `≈${Math.round(tray.remainingPercentage)}%`;
      lines.push(
        `${tableCell(tray.id, 4).padEnd(4)}  ${tableCell(empty ? "Empty" : tray.material || "Unknown", 12).padEnd(12)}  ${remaining.padStart(9)}  ${empty ? "–" : describeFilamentColor(tray.color)}`,
      );
    }
    lines.push("```");
  }
  lines.push(
    "≈ estimated amount remaining · Color squares show approximate base colors.",
  );
  return lines.join("\n");
}
