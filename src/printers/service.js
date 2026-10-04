import { createHash } from "node:crypto";
import { readPrinterConfig, readPrinterEnv } from "../config.js";
import { fetchBambu } from "./bambu.js";
import { fetchMoonraker } from "./moonraker.js";
import { fetchOctoprint } from "./octoprint.js";
import { fetchPrusalink } from "./prusalink.js";
import { StatusError, status } from "./status.js";

export function resolveTarget(config, target = "all") {
  const key = target.toLowerCase();
  if (key === "all")
    return Object.keys(config.printers).filter(
      (id) => config.printers[id].enabled !== false,
    );
  if (Object.hasOwn(config.printers, key)) return [key];
  if (Object.hasOwn(config.groups, key))
    return [...new Set(config.groups[key])];
  return [];
}

export function createPrinterService({
  load = readPrinterConfig,
  adapters = {
    bambu: fetchBambu,
    moonraker: fetchMoonraker,
    octoprint: fetchOctoprint,
    prusalink: fetchPrusalink,
  },
  env,
  loadEnv = readPrinterEnv,
  concurrency = 4,
  cacheMs = 5000,
} = {}) {
  const pending = new Map();
  const cache = new Map();
  const waiting = [];
  let active = 0;

  async function limited(task) {
    if (active >= concurrency)
      await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      if (waiting.length) waiting.shift()();
      else active--;
    }
  }

  async function fetchStatus(printer, wantAMS = false) {
    if (printer.enabled === false) return status({ state: "disabled" });
    let runtimeEnv;
    try {
      runtimeEnv = env ?? (await loadEnv());
    } catch {
      return status({
        state: "unavailable",
        error: "Printer credentials could not be read from .env.",
      });
    }
    const credentials = createHash("sha256")
      .update(
        JSON.stringify([
          runtimeEnv[printer.passwordEnv],
          runtimeEnv[printer.apiKeyEnv],
        ]),
      )
      .digest("hex");
    const key = JSON.stringify([printer, wantAMS, credentials]);
    const now = Date.now();
    for (const [id, entry] of cache)
      if (now - entry.time >= cacheMs) cache.delete(id);
    const cached = cache.get(key);
    if (cached) return { ...cached.value, cached: true };
    if (pending.has(key)) return pending.get(key);
    const task = limited(async () => {
      let value;
      try {
        const adapter = adapters[printer.protocol];
        if (!adapter)
          throw new StatusError(
            "The printer connection protocol is not supported.",
          );
        value = await adapter(printer, { env: runtimeEnv, wantAMS });
      } catch (error) {
        value = status({
          state: "unavailable",
          error:
            error instanceof StatusError
              ? error.message
              : "Status could not be fetched; check the printer configuration.",
        });
      }
      if (value.error) {
        value = { ...value, error: String(value.error) };
        for (const secret of [
          printer.password,
          printer.apiKey,
          runtimeEnv[printer.passwordEnv],
          runtimeEnv[printer.apiKeyEnv],
        ]) {
          if (secret)
            value.error = value.error.replaceAll(secret, "[redacted]");
        }
      }
      value = { ...value, observedAt: new Date().toISOString() };
      cache.set(key, { value, time: Date.now() });
      return value;
    });
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  }

  return { load, fetchStatus };
}
