import test from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { discoverBambu, parseDiscovery } from "../src/printers/discovery.js";
import {
  inspectBambu,
  printerId,
  savePrinters,
} from "../src/printers/onboarding.js";
import { addPrinter } from "../scripts/printer-add.mjs";
import { StatusError } from "../src/printers/status.js";

const discovery = { displayName: "P2S#1", deviceId: "SERIALONE" };
const info = {
  model: "Bambu Lab P2S",
  firmwareVersion: "01.03.00.00",
  ams: [
    {
      name: "AMS 2 Pro (1)",
      serialNumber: "AMS_ONE",
      firmwareVersion: "05.00.22.22",
    },
  ],
};
const printer = {
  brand: "bambulab",
  protocol: "bambu",
  host: "printer.invalid",
  deviceId: "SERIALONE",
  passwordEnv: "BAMBU_P2S1_ACCESS_CODE",
  displayName: "P2S#1",
  ...info,
};
const response = (serial = "SERIALONE", name = "P2S#1") =>
  Buffer.from(
    `HTTP/1.1 200 OK\r\nUSN: ${serial}\r\nDevName.bambu.com: ${name}\r\n\r\n`,
  );

async function files(t, config = { printers: {}, groups: {} }) {
  const folder = await mkdtemp(join(tmpdir(), "skillsbot-onboarding-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const configPath = join(folder, "printers.json");
  const envPath = join(folder, ".env");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await writeFile(
    envPath,
    '# Keep this comment\nDISCORD_TOKEN="private-test-token"\nUNRELATED=value\n',
    { mode: 0o600 },
  );
  return { folder, configPath, envPath };
}

test("discovery parses names and serials without retaining other LAN fields", () => {
  assert.deepEqual(parseDiscovery(response()), discovery);
  assert.equal(
    parseDiscovery(
      response("uuid:SERIALONE::urn:bambulab-com:device:3dprinter:1"),
    ).deviceId,
    "SERIALONE",
  );
  for (const packet of [
    Buffer.from("not-http"),
    response("topic/+/wildcard"),
    Buffer.from("HTTP/1.1 200 OK\r\nUSN: ONE\r\nUSN: TWO\r\n"),
    Buffer.alloc(20000),
  ])
    assert.equal(parseDiscovery(packet), null);
  assert.equal(
    parseDiscovery(response("SERIALONE", "x".repeat(81))).displayName,
    undefined,
  );
});

test("real UDP discovery queries only the chosen host, checks serials, and times out cleanly", async (t) => {
  const server = createSocket("udp4");
  await new Promise((resolve) => server.bind(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  let reply = true;
  server.on("message", (packet, source) => {
    assert.match(packet.toString(), /^M-SEARCH \* HTTP\/1\.1/);
    assert.doesNotMatch(packet.toString(), /password|LAN_CODE/);
    if (reply) server.send(response(), source.port, source.address);
  });
  const options = { port: server.address().port, timeoutMs: 150 };
  assert.deepEqual(await discoverBambu("127.0.0.1", options), discovery);
  await assert.rejects(
    discoverBambu("127.0.0.1", { ...options, deviceId: "OTHER" }),
    /different serial number/,
  );
  reply = false;
  assert.equal(await discoverBambu("127.0.0.1", options), null);
});

test("inspection authenticates using the supplied code, defaults to verified TLS and removes unrelated accessories", async () => {
  let connection;
  const result = await inspectBambu(
    {
      ...printer,
      accessories: [{ name: "Fan" }],
      username: "bblp",
      port: 8883,
      enabled: true,
    },
    {
      discovery,
      accessCode: "newcode1",
      fetch: async (p, options) => {
        connection = p;
        assert.equal(options.wantInfo, true);
        assert.equal(options.wantAMS, true);
        return { state: "idle", info };
      },
    },
  );
  assert.equal(connection.password, "newcode1");
  assert.equal(connection.passwordEnv, undefined);
  assert.equal(connection.tls.rejectUnauthorized, true);
  assert.equal(connection.tls.servername, "SERIALONE");
  for (const field of [
    "password",
    "accessories",
    "username",
    "port",
    "enabled",
  ])
    assert.equal(Object.hasOwn(result.printer, field), false);
  assert.equal(result.printer.ams.length, 1);
  assert.equal(result.printer.displayName, "P2S#1");
});

test("manual naming and serial fallback work when LAN discovery is unavailable", async () => {
  const result = await inspectBambu(printer, {
    discovery: null,
    displayName: "Custom name",
    fetch: async () => ({ info }),
  });
  assert.equal(result.printer.displayName, "Custom name");
  assert.equal(result.printer.passwordEnv, printer.passwordEnv);
  await assert.rejects(
    inspectBambu({ host: "printer.invalid" }, { discovery: null }),
    /serial number/,
  );
  let calls = 0;
  await assert.rejects(
    inspectBambu(printer, {
      discovery: { ...discovery, deviceId: "OTHER" },
      fetch: async () => {
        calls++;
      },
    }),
    /different serial number/,
  );
  assert.equal(calls, 0);
});

test("adding a discovered printer needs no manual name or serial, keeps secrets private and creates a group", async (t) => {
  const paths = await files(t);
  const prompts = [];
  const logs = [];
  const result = await addPrinter(paths, {
    discover: async () => discovery,
    prompt: async (question, options) => {
      prompts.push([question, options]);
      if (question.includes("IP")) return "printer.invalid";
      if (options?.hidden) return "privatecode";
      if (question.startsWith("Group")) return "P2S";
      assert.fail(`Unexpected prompt: ${question}`);
    },
    inspect: (p, options) =>
      inspectBambu(p, { ...options, fetch: async () => ({ info }) }),
    log: (line) => logs.push(line),
  });
  assert.equal(result.id, "p2s1");
  assert.equal(prompts.length, 3);
  assert.equal(prompts[1][1].hidden, true);
  const saved = JSON.parse(await readFile(paths.configPath, "utf8"));
  assert.deepEqual(saved.groups, { p2s: ["p2s1"] });
  assert.equal(saved.printers.p2s1.deviceId, "SERIALONE");
  assert.doesNotMatch(JSON.stringify(saved), /privatecode/);
  assert.doesNotMatch(logs.join("\n"), /privatecode|private-test-token/);
  const env = await readFile(paths.envPath, "utf8");
  assert.equal(parseEnv(env).BAMBU_P2S1_ACCESS_CODE, "privatecode");
  assert.ok(
    env.startsWith(
      '# Keep this comment\nDISCORD_TOKEN="private-test-token"\nUNRELATED=value\n',
    ),
  );
  for (const path of [paths.configPath, paths.envPath])
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  const backupName = (await readdir(join(paths.folder, ".backups")))[0];
  const backup = join(paths.folder, ".backups", backupName);
  assert.equal((await stat(backup)).mode & 0o777, 0o700);
  assert.equal((await stat(join(backup, ".env"))).mode & 0o777, 0o600);
});

test("adding an existing serial updates it without changing its ID or group membership", async (t) => {
  const config = {
    printers: { legacy: printer },
    groups: { farm: ["legacy"] },
  };
  const paths = await files(t, config);
  const result = await addPrinter(
    { ...paths, host: "new-printer.invalid", group: "" },
    {
      discover: async () => ({ ...discovery, displayName: "New name" }),
      prompt: async (_, options) => {
        assert.equal(options.hidden, true);
        return "newcode1";
      },
      inspect: (p, options) =>
        inspectBambu(p, { ...options, fetch: async () => ({ info }) }),
      log: () => {},
    },
  );
  const saved = JSON.parse(await readFile(paths.configPath, "utf8"));
  assert.equal(result.id, "legacy");
  assert.deepEqual(saved.groups, config.groups);
  assert.equal(saved.printers.legacy.displayName, "New name");
  assert.equal(saved.printers.legacy.passwordEnv, printer.passwordEnv);
  assert.equal(Object.keys(saved.printers).length, 1);
});

test("failed connection leaves printer configuration and credentials unchanged", async (t) => {
  const paths = await files(t);
  const before = await Promise.all([
    readFile(paths.configPath, "utf8"),
    readFile(paths.envPath, "utf8"),
  ]);
  await assert.rejects(
    addPrinter(
      { ...paths, host: "printer.invalid", group: "" },
      {
        discover: async () => discovery,
        prompt: async () => "wrongcode",
        inspect: async () => {
          throw new StatusError("LAN access code was denied.");
        },
        log: () => {},
      },
    ),
    /LAN access code was denied/,
  );
  assert.deepEqual(
    await Promise.all([
      readFile(paths.configPath, "utf8"),
      readFile(paths.envPath, "utf8"),
    ]),
    before,
  );
});

test("saving rejects duplicate serials, invalid groups and concurrent changes before writing credentials", async (t) => {
  const paths = await files(t, {
    printers: { p2s1: printer },
    groups: { p2s: ["p2s1"] },
  });
  const before = await readFile(paths.envPath, "utf8");
  for (const update of [
    { id: "duplicate", printer },
    { id: "p2s1", printer, group: "all" },
    { id: "p2s1", printer, previous: { ...printer, displayName: "Changed" } },
  ])
    await assert.rejects(
      savePrinters([update], {
        ...paths,
        credential: { key: printer.passwordEnv, code: "newcode1" },
      }),
    );
  assert.equal(await readFile(paths.envPath, "utf8"), before);
  await writeFile(`${paths.configPath}.lock`, "locked");
  await assert.rejects(
    savePrinters([{ id: "p2s1", printer }], paths),
    /Another printer setup/,
  );
  assert.equal(await readFile(`${paths.configPath}.lock`, "utf8"), "locked");
});

test("generated command IDs avoid duplicates, group names and reserved all", () => {
  assert.equal(printerId("X2D#1", { printers: {}, groups: {} }), "x2d1");
  assert.equal(
    printerId("P2S#1", { printers: { p2s1: {} }, groups: { "p2s1-2": [] } }),
    "p2s1-3",
  );
  assert.equal(printerId("all", { printers: {}, groups: {} }), "bambu");
  assert.equal(printerId("###", { printers: {}, groups: {} }), "bambu");
});

test("printer setup refuses to overwrite the Discord token", async (t) => {
  const paths = await files(t);
  const before = await readFile(paths.envPath, "utf8");
  await assert.rejects(
    savePrinters([{ id: "p2s1", printer }], {
      ...paths,
      credential: { key: "DISCORD_TOKEN", code: "newcode1" },
    }),
    /Discord token/,
  );
  assert.equal(await readFile(paths.envPath, "utf8"), before);
  assert.deepEqual(JSON.parse(await readFile(paths.configPath, "utf8")), {
    printers: {},
    groups: {},
  });
});
