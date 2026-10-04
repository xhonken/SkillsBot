export class StatusError extends Error {}

export function number(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    typeof value === "boolean"
  )
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function percentage(value) {
  const parsed = number(value);
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null;
}

export function seconds(value) {
  const parsed = number(value);
  return parsed !== null && parsed >= 0 ? Math.round(parsed) : null;
}

export function state(value) {
  const text = String(value ?? "").toLowerCase();
  if (["running", "printing"].includes(text)) return "printing";
  if (["pause", "paused", "pausing"].includes(text)) return "paused";
  if (["idle", "ready", "operational", "standby"].includes(text)) return "idle";
  if (["finish", "finished", "complete", "completed"].includes(text))
    return "completed";
  if (["failed", "error", "shutdown"].includes(text)) return "error";
  if (["offline", "disconnected", "offline after error"].includes(text))
    return "offline";
  if (["stopped", "cancelled", "canceled"].includes(text)) return "cancelled";
  if (
    [
      "busy",
      "prepare",
      "preparing",
      "init",
      "opening serial connection",
    ].includes(text)
  )
    return "preparing";
  if (text === "attention") return "attention";
  return "unknown";
}

export function status(values) {
  return {
    state: "unknown",
    percentage: null,
    remainingSeconds: null,
    error: null,
    ams: null,
    ...values,
  };
}

export function secret(printer, key, env = process.env) {
  const variable = printer[`${key}Env`];
  const value = variable ? env[variable] : printer[key];
  if (variable && !value)
    throw new StatusError(`Miljövariabeln ${variable} saknas.`);
  return value;
}
