import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const BRANDS = Object.freeze({
  bambulab: "Bambu Lab",
  prusa: "Prusa",
  creality: "Creality",
  anycubic: "Anycubic",
  elegoo: "Elegoo",
  sovol: "Sovol",
  qidi: "QIDI",
  flashforge: "Flashforge",
  ultimaker: "UltiMaker",
  voron: "Voron",
});
export const PROTOCOLS = ["bambu", "moonraker", "octoprint", "prusalink"];

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function ids(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((id) => !/^\d{17,20}$/.test(id) || typeof id !== "string")
  ) {
    throw new Error(`${label} must contain Discord IDs as strings`);
  }
  return [...new Set(value)];
}

export function namespacePrinterPermissions(permissions = {}) {
  const result = { ...permissions };
  for (const key of ["status", "ams", "printers", "brands"]) {
    if (!Object.hasOwn(result, key)) continue;
    const next = `3d.${key}`;
    if (
      Object.hasOwn(result, next) &&
      JSON.stringify(result[next]) !== JSON.stringify(result[key])
    )
      throw new Error(`Conflicting permission settings: ${key} and ${next}`);
    result[next] = result[key];
    delete result[key];
  }
  return result;
}

export function validateBotConfig(value) {
  object(value, "Bot configuration");
  const permissions = value.permissions ?? {};
  object(permissions, "permissions");
  for (const [key, list] of Object.entries(permissions))
    ids(list, `permissions.${key}`);
  if (
    value.skills !== undefined &&
    (!Array.isArray(value.skills) ||
      value.skills.some(
        (name) => typeof name !== "string" || !/^[a-z0-9_-]+$/.test(name),
      ))
  ) {
    throw new Error("skills must contain skill names");
  }
  return {
    owners: ids(value.owners ?? [], "owners"),
    channelIds: ids(value.channelIds ?? [], "channelIds"),
    permissions: namespacePrinterPermissions(permissions),
    skills: [...new Set(value.skills ?? [])],
  };
}

function name(value, label) {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value) || value === "all") {
    throw new Error(
      `${label} must use lowercase letters, numbers, hyphens or underscores (not all)`,
    );
  }
}

export function validatePrinterConfig(value) {
  object(value, "Printer configuration");
  object(value.printers, "printers");
  object(value.groups, "groups");
  for (const [id, printer] of Object.entries(value.printers)) {
    name(id, "Printer name");
    object(printer, `printers.${id}`);
    if (
      printer.displayName !== undefined &&
      (typeof printer.displayName !== "string" ||
        !printer.displayName.trim() ||
        printer.displayName.length > 80 ||
        /[\r\n]/.test(printer.displayName))
    )
      throw new Error(
        `Printer ${id}: displayName must be 1–80 characters on one line`,
      );
    for (const field of ["model", "firmwareVersion"]) {
      if (
        printer[field] !== undefined &&
        (typeof printer[field] !== "string" ||
          !printer[field].trim() ||
          printer[field].length > 80 ||
          /[\x00-\x1f\x7f]/.test(printer[field]))
      )
        throw new Error(`Printer ${id}: invalid ${field}`);
    }
    if (printer.ams !== undefined) {
      if (!Array.isArray(printer.ams))
        throw new Error(`Printer ${id}: ams must be an array`);
      for (const unit of printer.ams) {
        object(unit, `Printer ${id} AMS unit`);
        if (
          typeof unit.name !== "string" ||
          !unit.name.trim() ||
          unit.name.length > 80 ||
          /[\x00-\x1f\x7f]/.test(unit.name)
        )
          throw new Error(`Printer ${id}: invalid AMS name`);
        if (
          unit.serialNumber !== undefined &&
          (typeof unit.serialNumber !== "string" ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(unit.serialNumber))
        )
          throw new Error(`Printer ${id}: invalid AMS serial number`);
        if (
          unit.firmwareVersion !== undefined &&
          (typeof unit.firmwareVersion !== "string" ||
            !unit.firmwareVersion.trim() ||
            unit.firmwareVersion.length > 40 ||
            /[\x00-\x1f\x7f]/.test(unit.firmwareVersion))
        )
          throw new Error(`Printer ${id}: invalid AMS firmware version`);
      }
    }
    if (!Object.hasOwn(BRANDS, printer.brand))
      throw new Error(`Printer ${id}: unknown brand`);
    if (!PROTOCOLS.includes(printer.protocol))
      throw new Error(`Printer ${id}: choose a supported protocol`);
    if (printer.enabled !== undefined && typeof printer.enabled !== "boolean")
      throw new Error(`Printer ${id}: enabled must be boolean`);
    if (
      printer.timeoutMs !== undefined &&
      (!Number.isInteger(printer.timeoutMs) ||
        printer.timeoutMs < 100 ||
        printer.timeoutMs > 60000)
    )
      throw new Error(`Printer ${id}: timeoutMs must be 100–60000`);
    for (const key of ["apiKeyEnv", "passwordEnv"]) {
      if (
        printer[key] !== undefined &&
        (typeof printer[key] !== "string" ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(printer[key]))
      )
        throw new Error(`Printer ${id}: invalid ${key}`);
    }
    if (printer.protocol === "bambu") {
      if (printer.brand !== "bambulab")
        throw new Error(`Printer ${id}: bambu protocol requires bambulab`);
      if (
        typeof printer.host !== "string" ||
        !/^[a-zA-Z0-9.-]+$/.test(printer.host)
      )
        throw new Error(
          `Printer ${id}: host must be a hostname or IPv4 address`,
        );
      if (
        typeof printer.deviceId !== "string" ||
        !/^[a-zA-Z0-9_-]+$/.test(printer.deviceId)
      )
        throw new Error(
          `Printer ${id}: deviceId must be the printer serial number`,
        );
      if (!printer.passwordEnv && !printer.password)
        throw new Error(`Printer ${id}: configure passwordEnv`);
      if (
        printer.port !== undefined &&
        (!Number.isInteger(printer.port) ||
          printer.port < 1 ||
          printer.port > 65535)
      )
        throw new Error(`Printer ${id}: invalid port`);
      if (printer.tls !== undefined) {
        object(printer.tls, `Printer ${id} tls`);
        if (
          printer.tls.rejectUnauthorized !== undefined &&
          typeof printer.tls.rejectUnauthorized !== "boolean"
        )
          throw new Error(`Printer ${id}: invalid TLS verification setting`);
        if (
          printer.tls.caFile !== undefined &&
          typeof printer.tls.caFile !== "string"
        )
          throw new Error(`Printer ${id}: invalid TLS CA file`);
        if (
          printer.tls.servername !== undefined &&
          (typeof printer.tls.servername !== "string" ||
            !/^[a-zA-Z0-9.-]+$/.test(printer.tls.servername))
        )
          throw new Error(`Printer ${id}: invalid TLS servername`);
      }
    } else {
      let url;
      try {
        url = new URL(printer.url);
      } catch {
        throw new Error(`Printer ${id}: configure an HTTP(S) url`);
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(
          `Printer ${id}: invalid HTTP(S) url; put credentials in separate fields`,
        );
    }
    for (const key of ["username", "password", "apiKey"]) {
      if (
        printer[key] !== undefined &&
        (typeof printer[key] !== "string" || /[\r\n]/.test(printer[key]))
      )
        throw new Error(`Printer ${id}: invalid ${key}`);
    }
  }
  for (const [id, members] of Object.entries(value.groups)) {
    name(id, "Group name");
    if (Object.hasOwn(value.printers, id))
      throw new Error(`Group ${id} conflicts with a printer name`);
    if (
      !Array.isArray(members) ||
      !members.length ||
      members.some(
        (member) =>
          typeof member !== "string" || !Object.hasOwn(value.printers, member),
      )
    )
      throw new Error(`Group ${id} must reference existing printers`);
  }
  return value;
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${path}`);
  }
}

export async function readBotConfig(
  path = process.env.BOT_CONFIG || resolve(ROOT, "config.json"),
) {
  return validateBotConfig(await readJson(path));
}

export async function readPrinterConfig(
  path = process.env.PRINTER_CONFIG || resolve(ROOT, "printers.json"),
) {
  return validatePrinterConfig(await readJson(path));
}

// Printer credentials can be added while the bot is running. Do not change the
// process environment: the Discord token and core configuration stay separate.
export async function readPrinterEnv(
  path = process.env.PRINTER_ENV_FILE || resolve(ROOT, ".env"),
  env = process.env,
) {
  try {
    return { ...env, ...parseEnv(await readFile(path, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return { ...env };
    throw new Error(
      "Printer credentials could not be read from the .env file.",
    );
  }
}
