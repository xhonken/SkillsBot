import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHelp, registerInfo } from "../src/core.js";
import { registerPrinterSkill } from "../src/skills/3dprinter.js";
import { chunks, reply } from "../src/messages.js";
import { status } from "../src/printers/status.js";
import { formatAMS } from "../src/printers/format.js";
import { BRANDS } from "../src/config.js";

const owner = "111111111111111111";
const other = "222222222222222222";
const config = {
  owners: [owner, "333333333333333333"],
  channelIds: ["channel"],
  permissions: {},
};
const printers = {
  printers: {
    bambu: { brand: "bambulab", protocol: "bambu" },
    voron: { brand: "voron", protocol: "moonraker" },
    solo: { brand: "prusa", protocol: "prusalink" },
  },
  groups: { farm: ["bambu", "voron"] },
};

function message(content, authorId = owner, extra = {}) {
  const replies = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guildId: "guild",
    channelId: "channel",
    replies,
    reply: async (payload) => {
      replies.push(payload);
    },
    ...extra,
  };
}

test("!info responds only to configured owners with the version and loaded skills", async () => {
  const client = new EventEmitter();
  client.skills = new Map([
    ["3dprinter", { name: "3dprinter" }],
    ["hello", { name: "hello" }],
  ]);
  registerInfo(client, config, "0.2.0");
  const handle = client.listeners("messageCreate")[0];
  for (const author of config.owners) {
    const msg = message("!info", author);
    await handle(msg);
    assert.match(
      msg.replies[0].content,
      /Version\s+v0\.2\.0[\s\S]*Loaded skills\s+3dprinter, hello/,
    );
    assert.deepEqual(msg.replies[0].allowedMentions, {
      parse: [],
      repliedUser: false,
    });
  }
  for (const msg of [
    message("!info", other),
    message("info"),
    message("!info extra"),
    message("!info", owner, { guildId: null }),
    message("!info", owner, { channelId: "another" }),
    message("!info", owner, { author: { bot: true, id: owner } }),
  ]) {
    await handle(msg);
    assert.equal(msg.replies.length, 0);
  }
});

test("main help remains available without skills and labels owner-only commands", async () => {
  const client = new EventEmitter();
  client.skills = new Map();
  registerHelp(client, config);
  const handle = client.listeners("messageCreate")[0];
  for (const author of [owner, other]) {
    const msg = message(" !HELP ", author);
    await handle(msg);
    assert.equal(msg.replies.length, 1);
    const text = msg.replies[0].content;
    for (const command of ["!help", "!info", "!skills"])
      assert.ok(text.includes(command));
    assert.doesNotMatch(text, /!skill\s/);
    assert.match(text, /!info.*owners only/);
    assert.match(text, /No skills are loaded/);
    assert.deepEqual(msg.replies[0].allowedMentions, {
      parse: [],
      repliedUser: false,
    });
  }
});

test("main help respects configured permissions, channels and server-only commands", async () => {
  const client = new EventEmitter();
  client.skills = new Map();
  registerHelp(client, { ...config, permissions: { help: [owner] } });
  const handle = client.listeners("messageCreate")[0];
  const denied = message("!help", other);
  await handle(denied);
  assert.match(denied.replies[0].content, /do not have permission/);
  assert.doesNotMatch(denied.replies[0].content, /!info|!skill/);
  const allowed = message("!help", owner);
  await handle(allowed);
  assert.match(allowed.replies[0].content, /Main bot/);
  for (const msg of [
    message("!help", owner, { guildId: null }),
    message("!help", owner, { channelId: "another" }),
    message("!help", owner, { author: { id: owner, bot: true } }),
    message("!help extra more"),
  ]) {
    await handle(msg);
    assert.equal(msg.replies.length, 0);
  }
});

test("skill-specific help is supplied by the core and follows the loaded namespace", async () => {
  const client = new EventEmitter();
  client.skills = new Map([
    [
      "3dprinter",
      {
        name: "3dprinter",
        namespace: "3d",
        commands: [
          {
            command: "!3d status <target>",
            description: "Printer status.",
            permission: "3d.status",
          },
        ],
      },
    ],
  ]);
  registerHelp(client, config);
  const handle = client.listeners("messageCreate")[0];
  for (const command of [
    "!3d",
    "!3d help",
    "!help 3d",
    "!help 3dprinter",
    " !3D HELP ",
  ]) {
    const msg = message(command, other);
    await handle(msg);
    assert.match(msg.replies[0].content, /Skill: 3dprinter \(!3d\)/);
    assert.match(msg.replies[0].content, /!3d status/);
    assert.doesNotMatch(msg.replies[0].content, /Main bot|!info/);
  }
  client.skills.clear();
  const unloaded = message("!3d help");
  await handle(unloaded);
  assert.equal(unloaded.replies.length, 0);
  const missing = message("!help 3d");
  await handle(missing);
  assert.match(missing.replies[0].content, /No loaded skill/);
});

test("global and per-skill help restrictions apply to namespace help", async () => {
  for (const permissions of [{ help: [owner] }, { "3d.help": [owner] }]) {
    const client = new EventEmitter();
    client.skills = new Map([
      ["3dprinter", { name: "3dprinter", namespace: "3d", commands: [] }],
    ]);
    registerHelp(client, { ...config, permissions });
    for (const command of ["!3d", "!3d help", "!help 3d"]) {
      const msg = message(command, other);
      await client.listeners("messageCreate")[0](msg);
      assert.match(msg.replies[0].content, /do not have permission/);
    }
  }
});

test("large combined help retains every skill command and suppresses mentions", async () => {
  const client = new EventEmitter();
  client.skills = new Map([
    [
      "many",
      {
        name: "many",
        commands: Array.from({ length: 40 }, (_, n) => ({
          command: `!command${n}`,
          description: `Description ${n}: ${"details ".repeat(15)} @everyone`,
          permission: "private",
        })),
      },
    ],
  ]);
  registerHelp(client, config);
  const msg = message("!help", other);
  await client.listeners("messageCreate")[0](msg);
  assert.ok(msg.replies.length > 1);
  const text = msg.replies.map((reply) => reply.content).join("\n");
  for (let n = 0; n < 40; n++)
    assert.match(text, new RegExp(`^!command${n}\\s`, "m"));
  assert.match(text, /permission required/);
  assert.doesNotMatch(text, /@everyone/);
  assert.ok(
    msg.replies.every(
      (reply) =>
        reply.content.length <= 1900 &&
        !reply.allowedMentions.parse.length &&
        (reply.content.match(/^```/gm) || []).length % 2 === 0,
    ),
  );
});

function setup(settings = config, cooldownMs = 0) {
  const client = new EventEmitter();
  const calls = [];
  const service = {
    load: async () => printers,
    fetchStatus: async (printer, ams) => {
      calls.push([printer, ams]);
      return status({
        state: "printing",
        percentage: 42,
        remainingSeconds: 900,
        ams: [
          {
            id: "0",
            trays: [
              {
                id: "0",
                material: "PLA",
                remainingPercentage: 65,
                color: "C12E1FFF",
              },
            ],
          },
        ],
      });
    },
  };
  registerPrinterSkill(client, { config: settings, service, cooldownMs });
  return { handle: client.listeners("messageCreate")[0], calls, service };
}

test("printer, group and all commands select the right printers, including standalone", async () => {
  for (const [target, count] of [
    ["bambu", 1],
    ["farm", 2],
    ["all", 3],
    ["FARM", 2],
  ]) {
    const { handle, calls } = setup();
    const msg = message(`!3d status ${target}`, other);
    await handle(msg);
    assert.equal(calls.length, count);
    assert.match(msg.replies[0].content, /42%[\s\S]*15 min/);
  }
});

test("display labels appear in status and AMS replies while commands use printer IDs", async () => {
  const { handle, service, calls } = setup();
  service.load = async () => ({
    printers: {
      x2d1: { brand: "bambulab", protocol: "bambu", displayName: "X2D#1" },
    },
    groups: { farm: ["x2d1"] },
  });
  for (const command of [
    "!3d status x2d1",
    "!3d status farm",
    "!3d ams x2d1",
  ]) {
    const msg = message(command);
    await handle(msg);
    assert.match(msg.replies[0].content, /^\*\*X2D#1\*\*/);
  }
  const list = message("!3d printers");
  await handle(list);
  assert.match(list.replies[0].content, /x2d1\s+X2D#1/);
  assert.equal(calls.length, 3);
});

test("permissions are checked before loading or contacting printers", async () => {
  const { handle, service, calls } = setup({
    ...config,
    permissions: { "3d.status": [owner] },
  });
  service.load = async () => {
    throw new Error("should not load");
  };
  const msg = message("!3d status all", other);
  await handle(msg);
  assert.match(msg.replies[0].content, /do not have permission/);
  assert.equal(calls.length, 0);
});

test("printer handlers ignore bare commands and commands owned by future AI or music skills", async () => {
  const { handle, service, calls } = setup();
  let loads = 0;
  service.load = async () => {
    loads++;
    return printers;
  };
  for (const command of [
    "!status all",
    "!ams all",
    "!printers",
    "!brands",
    "!addprinter",
    "!ai status",
    "!music status",
    "!3dprinter status",
    "!3dx status",
  ]) {
    const msg = message(command);
    await handle(msg);
    assert.equal(msg.replies.length, 0);
  }
  assert.equal(loads, 0);
  assert.equal(calls.length, 0);
  const uppercase = message(" !3D STATUS FARM ");
  await handle(uppercase);
  assert.equal(calls.length, 2);
  const unknown = message("!3d unknown");
  await handle(unknown);
  assert.match(unknown.replies[0].content, /!3d help/);
});

test("printer listings accept individual printers, groups and all without exposing connection secrets", async () => {
  const { handle, service, calls } = setup();
  service.load = async () => ({
    ...printers,
    printers: {
      ...printers.printers,
      bambu: {
        ...printers.printers.bambu,
        model: "Bambu Lab P2S",
        firmwareVersion: "01.03.00.00",
        ams: [{ name: "AMS 2 Pro" }],
        host: "private-host",
        password: "private-code",
      },
    },
  });
  const single = message("!3d printers bambu");
  await handle(single);
  const detail = single.replies[0].content;
  assert.match(detail, /Bambu Lab P2S/);
  assert.match(detail, /01\.03\.00\.00/);
  assert.match(detail, /AMS units\s+1/);
  assert.doesNotMatch(detail, /private-host|private-code|voron|solo/);
  const group = message("!3d printers FARM");
  await handle(group);
  assert.match(group.replies[0].content, /bambu/);
  assert.match(group.replies[0].content, /voron/);
  assert.doesNotMatch(group.replies[0].content, /solo/);
  const all = message("!3d printers all");
  await handle(all);
  assert.match(all.replies[0].content, /solo/);
  const missing = message("!3d printers missing");
  await handle(missing);
  assert.match(missing.replies[0].content, /No printer or group/);
  const invalid = message("!3d printers bambu voron");
  await handle(invalid);
  assert.match(invalid.replies[0].content, /Use !3d printers/);
  assert.equal(calls.length, 0);
});

test("AMS queries filter unsupported protocols without contacting them", async () => {
  const { handle, calls } = setup();
  const msg = message("!3d ams all", other);
  await handle(msg);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], true);
  assert.match(
    msg.replies[0].content,
    /```text\nAMS 0\nSlot\s+Filament\s+Remaining\s+Color/,
  );
  assert.match(msg.replies[0].content, /PLA\s+≈65%\s+🟥 Red/);
  assert.match(msg.replies[1].content, /voron[\s\S]*AMS is supported only/);
  assert.equal(msg.replies[0].files, undefined);
  assert.doesNotMatch(msg.replies[0].content, /C12E1FFF/);
});

test("AMS tables and color labels work without attachment permission", async () => {
  const { handle } = setup();
  const msg = message("!3d ams bambu", owner, {
    channel: { permissionsFor: () => ({ has: () => false }) },
  });
  await handle(msg);
  assert.equal(msg.replies[0].files, undefined);
  assert.match(msg.replies[0].content, /PLA\s+≈65%\s+🟥 Red/);
  assert.doesNotMatch(msg.replies[0].content, /C12E1FFF|Bifoga filer/);
});

test("large multi-unit AMS replies preserve code boxes, rows and Discord limits", async () => {
  const msg = message("!3d ams bambu");
  const report = status({
    state: "idle",
    ams: Array.from({ length: 32 }, (_, unit) => ({
      id: String(unit),
      trays: Array.from({ length: 4 }, (_, tray) => ({
        id: String(tray),
        material: "PLA",
        remainingPercentage: unit,
        color: "000000FF",
      })),
    })),
  });
  await reply(msg, formatAMS("bambu", report));
  assert.ok(msg.replies.length > 1);
  let rows = 0;
  for (const payload of msg.replies) {
    assert.ok(payload.content.length <= 1900);
    assert.equal((payload.content.match(/^```/gm) || []).length % 2, 0);
    rows += (payload.content.match(/^\d\s+PLA\s+≈\d+%\s+⬛ Black/gm) || [])
      .length;
    assert.deepEqual(payload.allowedMentions, {
      parse: [],
      repliedUser: false,
    });
  }
  assert.equal(rows, 128);
});

test("unknown target, too many arguments, empty config and invalid config give actionable replies", async () => {
  const { handle, calls, service } = setup();
  const unknown = message("!3d status missing");
  await handle(unknown);
  assert.match(unknown.replies[0].content, /No printer or group/);
  const many = message("!3d status bambu voron");
  await handle(many);
  assert.match(many.replies[0].content, /Enter a printer ID/);
  service.load = async () => ({ printers: {}, groups: {} });
  const empty = message("!3d status all");
  await handle(empty);
  assert.match(empty.replies[0].content, /No enabled/);
  service.load = async () => {
    throw new Error("secret invalid JSON");
  };
  const invalid = message("!3d status all");
  await handle(invalid);
  assert.match(invalid.replies[0].content, /npm run check/);
  assert.equal(calls.length, 0);
});

test("cooldown prevents duplicate queries", async () => {
  const { handle, calls } = setup(config, 5000);
  await handle(message("!3d status bambu"));
  const msg = message("!3d status bambu");
  await handle(msg);
  assert.match(msg.replies[0].content, /Wait/);
  assert.equal(calls.length, 1);
});

test("removed printer configuration commands return help without loading configuration or contacting printers", async () => {
  const { handle, calls, service } = setup();
  let loads = 0;
  service.load = async () => {
    loads++;
    return printers;
  };
  for (const author of [owner, other]) {
    for (const content of [
      "!3d addprinter",
      "!3d addgroup",
      "!3d addprinter p bambulab secret-host bblp secret-password serial",
      "!3d addgroup farm bambu voron",
    ]) {
      const msg = message(content, author);
      await handle(msg);
      assert.equal(msg.replies.length, 1);
      assert.match(msg.replies[0].content, /Unknown printer command.*!3d help/);
      assert.doesNotMatch(
        msg.replies[0].content,
        /secret-host|secret-password/,
      );
    }
  }
  assert.equal(loads, 0);
  assert.equal(calls.length, 0);
});

test("printer and brand tables preserve groups, disabled printers and supported connections", async () => {
  const { handle, service, calls } = setup();
  service.load = async () => ({
    ...printers,
    printers: {
      ...printers.printers,
      printer_with_underscore: {
        brand: "prusa",
        protocol: "prusalink",
        enabled: false,
      },
    },
  });
  const brands = message("!3d brands");
  await handle(brands);
  const brandText = brands.replies.map((reply) => reply.content).join("\n");
  for (const name of Object.values(BRANDS)) assert.ok(brandText.includes(name));
  for (const connection of ["bambu", "moonraker", "octoprint", "prusalink"])
    assert.ok(brandText.includes(connection));
  const list = message("!3d printers");
  await handle(list);
  const text = list.replies.map((reply) => reply.content).join("\n");
  assert.match(text, /printer_with_underscore.*disabled/);
  assert.match(text, /^farm\s+bambu, voron$/m);
  assert.equal(calls.length, 0);
});

test("long responses are split below Discord's message limit", async () => {
  const lines = Array.from(
    { length: 60 },
    (_, n) => `Printer ${n}: ${"status ".repeat(30)}`,
  ).join("\n");
  const parts = chunks(lines);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 1900));
  assert.equal(parts.join("\n"), lines);
  assert.ok(chunks("x".repeat(5000)).every((part) => part.length <= 1900));
});

test("split replies attach the color image once and suppress mentions on every message", async () => {
  const msg = message("!3d ams bambu");
  const file = { attachment: Buffer.from("image"), name: "colors.png" };
  await reply(msg, "x".repeat(4000), { files: [file] });
  assert.equal(msg.replies.length, 3);
  assert.deepEqual(msg.replies[0].files, [file]);
  assert.equal(msg.replies[1].files, undefined);
  assert.equal(msg.replies[2].files, undefined);
  assert.ok(
    msg.replies.every((payload) => !payload.allowedMentions.parse.length),
  );
});

test("unloading the printer skill suppresses replies from already pending queries", async () => {
  const client = new EventEmitter();
  let release;
  const service = {
    load: async () => printers,
    fetchStatus: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  const cleanup = registerPrinterSkill(client, {
    config,
    service,
    cooldownMs: 0,
  });
  const handle = client.listeners("messageCreate")[0];
  const msg = message("!3d status bambu");
  const running = handle(msg);
  await new Promise((resolve) => setImmediate(resolve));
  cleanup();
  release(status({ state: "printing", percentage: 50 }));
  await running;
  assert.equal(msg.replies.length, 0);
  assert.equal(client.listenerCount("messageCreate"), 0);
});
