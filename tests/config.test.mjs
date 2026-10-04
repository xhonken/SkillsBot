import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRANDS,
  readBotConfig,
  validateBotConfig,
  validatePrinterConfig,
} from "../src/config.js";
import { isOwner, hasPermission, acceptsMessage } from "../src/permissions.js";

const owner = "111111111111111111";
const other = "222222222222222222";
const printer = {
  brand: "voron",
  protocol: "moonraker",
  url: "http://printer.invalid:7125",
};
const settings = { owners: [owner], channelIds: [], permissions: {} };

test("multiple owners receive owner privileges; info is always owner-only", () => {
  const config = validateBotConfig({
    owners: [owner, other, owner],
    permissions: { info: [] },
  });
  assert.equal(config.owners.length, 2);
  assert.ok(isOwner(other, config));
  assert.ok(hasPermission(owner, "info", config));
  assert.equal(hasPermission("333333333333333333", "info", config), false);
});

test("read-only defaults and explicit permission lists", () => {
  assert.ok(hasPermission(other, "3d.status", settings));
  assert.equal(hasPermission(other, "ai.status", settings), false);
  const restricted = {
    ...settings,
    permissions: { "3d.status": ["333333333333333333"] },
  };
  assert.equal(hasPermission(other, "3d.status", restricted), false);
  assert.ok(hasPermission(owner, "3d.status", restricted));
  assert.ok(
    hasPermission(other, "3d.status", {
      ...settings,
      permissions: { "3d.status": [] },
    }),
  );
});

test("legacy printer permission lists migrate without granting another skill's status access", () => {
  const config = validateBotConfig({
    owners: [owner],
    permissions: {
      status: [other],
      ams: [],
      "ai.status": [owner],
      help: [other],
    },
  });
  assert.deepEqual(config.permissions, {
    "3d.status": [other],
    "3d.ams": [],
    "ai.status": [owner],
    help: [other],
  });
  assert.ok(hasPermission(other, "3d.status", config));
  assert.equal(hasPermission(other, "ai.status", config), false);
  assert.equal(hasPermission(other, "status", config), false);
  assert.throws(
    () =>
      validateBotConfig({ permissions: { status: [other], "3d.status": [] } }),
    /Conflicting permission/,
  );
});

test("Discord IDs must be strings and permissions must be arrays", () => {
  for (const value of [123456789012345678, "invalid", null])
    assert.throws(() => validateBotConfig({ owners: [value] }));
  assert.throws(() =>
    validateBotConfig({ permissions: { status: "everyone" } }),
  );
  assert.throws(() => validateBotConfig({ channelIds: [owner, 42] }));
  assert.throws(() => validateBotConfig({ skills: ["../arbitrary"] }));
});

test("guild channels are allowed; DMs, bots and excluded channels are ignored", () => {
  const message = {
    author: { id: owner, bot: false },
    guildId: "guild",
    channelId: "channel",
  };
  assert.ok(acceptsMessage(message, settings));
  assert.equal(acceptsMessage({ ...message, guildId: null }, settings), false);
  assert.equal(
    acceptsMessage({ ...message, author: { bot: true } }, settings),
    false,
  );
  assert.equal(
    acceptsMessage(message, { ...settings, channelIds: ["another"] }),
    false,
  );
});

test("invalid or missing bot configuration fails closed", async () => {
  const folder = await mkdtemp(join(tmpdir(), "printer-bot-config-"));
  try {
    const path = join(folder, "config.json");
    await assert.rejects(readBotConfig(path), { code: "ENOENT" });
    await writeFile(path, '{"owners": ["secret-content"], bad-json');
    await assert.rejects(
      readBotConfig(path),
      (error) => !error.message.includes("secret-content"),
    );
  } finally {
    await rm(folder, { recursive: true });
  }
});

test("catalog has ten families including Bambu and Voron", () => {
  assert.equal(Object.keys(BRANDS).length, 10);
  assert.equal(BRANDS.bambulab, "Bambu Lab");
  assert.equal(BRANDS.voron, "Voron");
});

test("standalone printers and overlapping groups validate", () => {
  const config = {
    printers: { v1: printer, v2: printer },
    groups: { farm: ["v1", "v2"], small: ["v1"] },
  };
  assert.equal(validatePrinterConfig(config), config);
});

test("printer display names allow readable labels and reject invalid values", () => {
  const config = (displayName) => ({
    printers: { x2d1: { ...printer, displayName } },
    groups: {},
  });
  assert.ok(validatePrinterConfig(config("X2D#1")));
  for (const value of ["", "   ", "name\nextra", "x".repeat(81), 123, null])
    assert.throws(() => validatePrinterConfig(config(value)));
});

test("configuration rejects missing members, ambiguous targets and unsupported protocols", () => {
  for (const config of [
    { printers: { v1: printer }, groups: { farm: ["missing"] } },
    { printers: { v1: printer }, groups: { v1: ["v1"] } },
    { printers: { all: printer }, groups: {} },
    { printers: { "Bad Name": printer }, groups: {} },
    { printers: { v1: { ...printer, protocol: "mock" } }, groups: {} },
    { printers: { v1: { ...printer, brand: "constructor" } }, groups: {} },
  ])
    assert.throws(() => validatePrinterConfig(config));
});

test("credential URLs, topic wildcards and invalid TLS settings are rejected", () => {
  const config = (p) => ({ printers: { p1: p }, groups: {} });
  assert.throws(() =>
    validatePrinterConfig(
      config({ ...printer, url: "http://user:secret@printer.invalid" }),
    ),
  );
  assert.throws(() =>
    validatePrinterConfig(config({ ...printer, url: "file:///etc/passwd" })),
  );
  const bambu = {
    brand: "bambulab",
    protocol: "bambu",
    host: "printer.invalid",
    deviceId: "SERIAL",
    passwordEnv: "BAMBU_CODE",
  };
  assert.ok(validatePrinterConfig(config(bambu)));
  assert.throws(() =>
    validatePrinterConfig(config({ ...bambu, deviceId: "+" })),
  );
  assert.throws(() =>
    validatePrinterConfig(
      config({ ...bambu, tls: { rejectUnauthorized: "false" } }),
    ),
  );
  assert.throws(() =>
    validatePrinterConfig(config({ ...bambu, timeoutMs: 0 })),
  );
  assert.throws(() => validatePrinterConfig(config({ ...bambu, port: 70000 })));
});
