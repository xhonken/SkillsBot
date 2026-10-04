import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrinterEnv } from "../src/config.js";
import {
  createPrinterService,
  resolveTarget,
} from "../src/printers/service.js";
import { StatusError, status } from "../src/printers/status.js";

test("targets include standalone printers, deduplicate groups and exclude disabled from all", () => {
  const config = {
    printers: { a: {}, b: {}, c: { enabled: false } },
    groups: { farm: ["a", "a", "b"] },
  };
  assert.deepEqual(resolveTarget(config), ["a", "b"]);
  assert.deepEqual(resolveTarget(config, "FARM"), ["a", "b"]);
  assert.deepEqual(resolveTarget(config, "c"), ["c"]);
  assert.deepEqual(resolveTarget(config, "constructor"), []);
  assert.deepEqual(resolveTarget(config, "missing"), []);
});

test("one failed printer does not interrupt others, and no adapter generates mock data", async () => {
  const service = createPrinterService({
    adapters: {
      moonraker: async (printer) => {
        if (printer.bad) throw new StatusError("MCU connection failed");
        return status({ state: "idle" });
      },
    },
  });
  const values = await Promise.all([
    service.fetchStatus({ protocol: "moonraker", bad: true }),
    service.fetchStatus({ protocol: "moonraker", bad: false }),
    service.fetchStatus({ protocol: "unsupported" }),
  ]);
  assert.equal(values[0].state, "unavailable");
  assert.equal(values[0].percentage, null);
  assert.match(values[0].error, /MCU connection/);
  assert.equal(values[1].state, "idle");
  assert.equal(values[2].state, "unavailable");
});

test("all concurrent requests share a four-connection maximum", async () => {
  let active = 0;
  let maximum = 0;
  const releases = [];
  const service = createPrinterService({
    env: {},
    adapters: {
      moonraker: async () => {
        active++;
        maximum = Math.max(active, maximum);
        await new Promise((resolve) => releases.push(resolve));
        active--;
        return status({ state: "idle" });
      },
    },
  });
  const tasks = Array.from({ length: 12 }, (_, id) =>
    service.fetchStatus({ protocol: "moonraker", id }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 4);
  while (releases.length) {
    releases.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all(tasks);
  assert.equal(maximum, 4);
  assert.equal(active, 0);
});

test("in-flight requests are deduplicated and recent status is marked as cached", async () => {
  let calls = 0;
  let release;
  const service = createPrinterService({
    env: {},
    adapters: {
      moonraker: async () => {
        calls++;
        await new Promise((resolve) => {
          release = resolve;
        });
        return status({ state: "printing", percentage: 10 });
      },
    },
  });
  const printer = { protocol: "moonraker" };
  const first = service.fetchStatus(printer);
  const second = service.fetchStatus(printer);
  release();
  assert.deepEqual(await first, await second);
  const cached = await service.fetchStatus(printer);
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
  assert.ok(cached.observedAt);
});

test("new and changed LAN codes are read without restarting and bypass stale cache", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "skillsbot-live-env-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, ".env");
  const calls = [];
  const service = createPrinterService({
    loadEnv: () => readPrinterEnv(path, { TEST_CODE: "old-process-value" }),
    adapters: {
      bambu: async (printer, { env }) => {
        calls.push(env[printer.passwordEnv]);
        return status({ state: "idle", error: env[printer.passwordEnv] });
      },
    },
  });
  const printer = { protocol: "bambu", passwordEnv: "TEST_CODE" };
  await writeFile(path, "TEST_CODE=firstcode\n");
  assert.equal((await service.fetchStatus(printer)).error, "[redacted]");
  assert.equal((await service.fetchStatus(printer)).cached, true);
  await writeFile(path, "TEST_CODE=nextcode\nNEW_CODE=newcode\n");
  assert.equal((await service.fetchStatus(printer)).cached, undefined);
  await service.fetchStatus({ protocol: "bambu", passwordEnv: "NEW_CODE" });
  assert.deepEqual(calls, ["firstcode", "nextcode", "newcode"]);
});

test("unreadable live credentials fail without contacting a printer or leaking the error", async () => {
  let calls = 0;
  const service = createPrinterService({
    loadEnv: async () => {
      throw new Error("private-file-content");
    },
    adapters: {
      bambu: async () => {
        calls++;
      },
    },
  });
  const report = await service.fetchStatus({ protocol: "bambu" });
  assert.equal(report.state, "unavailable");
  assert.doesNotMatch(report.error, /private-file-content/);
  assert.equal(calls, 0);
});

test("changed printer configuration bypasses the old status cache", async () => {
  let calls = 0;
  const service = createPrinterService({
    adapters: {
      moonraker: async () => {
        calls++;
        return status({ state: "idle" });
      },
    },
  });
  await service.fetchStatus({
    protocol: "moonraker",
    url: "http://first.invalid",
  });
  await service.fetchStatus({
    protocol: "moonraker",
    url: "http://second.invalid",
  });
  assert.equal(calls, 2);
});

test("disabled printers do not connect and configured credentials never appear in reported errors", async () => {
  let calls = 0;
  const service = createPrinterService({
    env: { TEST_PASSWORD: "private-password" },
    adapters: {
      bambu: async () => {
        calls++;
        return status({
          state: "error",
          error: "private-password and private-key",
        });
      },
    },
  });
  assert.equal(
    (await service.fetchStatus({ enabled: false, protocol: "bambu" })).state,
    "disabled",
  );
  assert.equal(calls, 0);
  const value = await service.fetchStatus({
    protocol: "bambu",
    passwordEnv: "TEST_PASSWORD",
    apiKey: "private-key",
  });
  assert.equal(value.error, "[redacted] and [redacted]");
});
