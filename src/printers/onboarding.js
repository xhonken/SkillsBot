import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { ROOT, validatePrinterConfig } from "../config.js";
import { fetchBambu } from "./bambu.js";
import { discoverBambu } from "./discovery.js";
import { StatusError } from "./status.js";

export function printerId(displayName, config) {
  const base =
    String(displayName)
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/^[^a-z0-9]+/, "")
      .slice(0, 40) || "bambu";
  let id = base === "all" ? "bambu" : base;
  for (
    let n = 2;
    Object.hasOwn(config.printers, id) || Object.hasOwn(config.groups, id);
    n++
  )
    id = `${base === "all" ? "bambu" : base}-${n}`;
  return id;
}

export async function inspectBambu(
  connection,
  {
    discovery,
    accessCode,
    displayName,
    env = process.env,
    discover = discoverBambu,
    fetch = fetchBambu,
  } = {},
) {
  const found =
    discovery === undefined
      ? await discover(connection.host, { deviceId: connection.deviceId })
      : discovery;
  if (found && connection.deviceId && found.deviceId !== connection.deviceId)
    throw new StatusError(
      "The IP address belongs to a printer with a different serial number.",
    );
  const deviceId = connection.deviceId || found?.deviceId;
  if (!deviceId)
    throw new StatusError(
      "The serial number could not be retrieved; enter it manually.",
    );
  const printer = {
    ...connection,
    brand: "bambulab",
    protocol: "bambu",
    deviceId,
    timeoutMs: connection.timeoutMs ?? 15000,
    tls: connection.tls ?? {
      rejectUnauthorized: true,
      caFile: "certs/bambu-printer-ca.crt",
      servername: deviceId,
    },
    ...(accessCode ? { password: accessCode } : {}),
  };
  // A supplied code must be tested instead of an old environment reference.
  if (accessCode) delete printer.passwordEnv;
  validatePrinterConfig({ printers: { probe: printer }, groups: {} });
  const report = await fetch(printer, { env, wantInfo: true, wantAMS: true });
  const { accessories, password, ...saved } = printer;
  if (!accessCode && password) saved.password = password;
  const info = report.info;
  if (!info || !Array.isArray(info.ams))
    throw new StatusError(
      "The printer model and AMS units could not be retrieved.",
    );
  if (saved.port === 8883) delete saved.port;
  if (saved.username === "bblp") delete saved.username;
  if (saved.enabled === true) delete saved.enabled;
  return {
    printer: {
      ...saved,
      displayName:
        displayName ||
        found?.displayName ||
        connection.displayName ||
        info.model ||
        `Bambu ${deviceId.slice(-6)}`,
      ...info,
    },
    discoveredName: Boolean(found?.displayName),
    status: report,
  };
}

function envWithCode(content, key, code) {
  if (key === "DISCORD_TOKEN")
    throw new StatusError(
      "The Discord token must not be replaced with a LAN access code.",
    );
  if (
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
    !/^[A-Za-z0-9_-]{4,128}$/.test(code)
  )
    throw new StatusError(
      "The LAN access code must contain letters, numbers, hyphens, or underscores.",
    );
  if (/[\r\n]/.test(parseEnv(content)[key] ?? ""))
    throw new StatusError(
      "An existing multiline environment variable cannot be replaced automatically.",
    );
  const line = `${key}=${code}`;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, "gm");
  return pattern.test(content)
    ? content.replace(pattern, () => line)
    : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
}

async function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

// Serialize local setup tools. Save credentials first, then expose the printer.
// Private backups allow rollback without printing any credential contents.
export async function savePrinters(
  updates,
  {
    configPath = process.env.PRINTER_CONFIG || resolve(ROOT, "printers.json"),
    envPath = process.env.PRINTER_ENV_FILE || resolve(ROOT, ".env"),
    credential,
  } = {},
) {
  const lockPath = `${configPath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new StatusError(
        "Another printer setup is already running. Retry when it finishes.",
      );
    throw error;
  }
  try {
    const original = await readFile(configPath, "utf8");
    const config = validatePrinterConfig(JSON.parse(original));
    for (const { id, printer, previous, group } of updates) {
      const current = config.printers[id];
      if (
        previous !== undefined &&
        JSON.stringify(current) !== JSON.stringify(previous)
      )
        throw new StatusError(
          "Printer configuration changed during the check; run setup again.",
        );
      if (current && current.deviceId !== printer.deviceId)
        throw new StatusError(
          "The chosen printer ID is already used by another printer.",
        );
      if (
        Object.entries(config.printers).some(
          ([other, p]) =>
            other !== id &&
            p.protocol === "bambu" &&
            p.deviceId === printer.deviceId,
        )
      )
        throw new StatusError(
          "The printer is already configured under a different ID.",
        );
      config.printers[id] = printer;
      if (group)
        config.groups[group] = [
          ...new Set([
            ...(Object.hasOwn(config.groups, group)
              ? config.groups[group]
              : []),
            id,
          ]),
        ];
    }
    validatePrinterConfig(config);
    let envContent = "";
    let envExists = true;
    let nextEnv;
    if (credential) {
      try {
        envContent = await readFile(envPath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        envExists = false;
      }
      nextEnv = envWithCode(envContent, credential.key, credential.code);
    }
    const backup = join(
      dirname(configPath),
      ".backups",
      `printers-${Date.now()}-${randomUUID().slice(0, 8)}`,
    );
    await mkdir(backup, { recursive: true, mode: 0o700 });
    await writeFile(join(backup, "printers.json"), original, {
      mode: 0o600,
      flag: "wx",
    });
    if (credential && envExists)
      await writeFile(join(backup, ".env"), envContent, {
        mode: 0o600,
        flag: "wx",
      });
    if (credential) await atomicWrite(envPath, nextEnv);
    try {
      await atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`);
    } catch (error) {
      if (credential) {
        if (envExists) await atomicWrite(envPath, envContent);
        else await rm(envPath, { force: true });
      }
      throw error;
    }
    return { config, backup };
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
