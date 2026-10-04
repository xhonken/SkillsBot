import { codeBox, fields, safeText } from "../messages.js";
import { describeFilamentColor } from "./ams-colors.js";

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return "okänd";
  if (seconds === 0) return "0 min";
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours
    ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`
    : `${minutes} min`;
}

export function formatStatus(name, status) {
  const labels = {
    printing: "Skriver ut",
    paused: "Pausad",
    idle: "Ingen pågående utskrift",
    completed: "Utskrift klar; ingen pågående utskrift",
    cancelled: "Utskrift stoppad; ingen pågående utskrift",
    offline: "Skrivaren är offline",
    unavailable: "Status kunde inte hämtas",
    disabled: "Inaktiverad i konfigurationen",
    error: "Skrivaren rapporterar fel",
    attention: "Skrivaren kräver åtgärd",
    unknown: "Okänd status",
    preparing: "Förbereder utskrift",
  };
  const rows = [["Status", labels[status.state] || labels.unknown]];
  if (["printing", "paused"].includes(status.state)) {
    const pct =
      status.percentage === null || status.percentage === undefined
        ? "okänd procent"
        : `${Math.round(status.percentage * 10) / 10}%`;
    rows.push(
      ["Framsteg", pct],
      ["Tid kvar", duration(status.remainingSeconds)],
    );
    if (status.estimateSource === "progress")
      rows.push(["Tidkälla", "uppskattning från framsteg"]);
  }
  if (status.error) rows.push(["Fel / HMS", status.error]);
  if (status.cached)
    rows.push(["Uppdatering", "hämtad under de senaste 5 sekunderna"]);
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
    return codeBox(name, "AMS-information rapporterades inte av skrivaren.");
  if (!status.ams.length)
    return codeBox(name, "Inga AMS-enheter rapporterades.");
  const lines = [title];
  for (const unit of status.ams) {
    lines.push("```text", `AMS ${tableCell(unit.id, 8)}`);
    if (!unit.trays.length) lines.push("Inga fack rapporterades.");
    else
      lines.push(
        "Fack  Filament         Kvar  Färg",
        "────  ────────────  ───────  ──────────────────",
      );
    for (const tray of unit.trays) {
      const empty = tray.present === false;
      const remaining = empty
        ? "–"
        : tray.remainingPercentage === null ||
            tray.remainingPercentage === undefined
          ? "Okänt"
          : `≈${Math.round(tray.remainingPercentage)}%`;
      lines.push(
        `${tableCell(tray.id, 4).padEnd(4)}  ${tableCell(empty ? "Tomt" : tray.material || "Okänd", 12).padEnd(12)}  ${remaining.padStart(7)}  ${empty ? "–" : describeFilamentColor(tray.color)}`,
      );
    }
    lines.push("```");
  }
  lines.push("≈ uppskattad mängd kvar · Färgrutor visar ungefärlig basfärg.");
  return lines.join("\n");
}
