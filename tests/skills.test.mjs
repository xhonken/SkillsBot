import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SkillManager,
  registerSkillListing,
  discoverSkills,
} from "../src/skill-manager.js";
import { validateBotConfig, readBotConfig } from "../src/config.js";
import { registerHelp, registerInfo } from "../src/core.js";

const owner = "111111111111111111";
const other = "222222222222222222";

function setup(names = []) {
  const client = new EventEmitter();
  client.skills = new Map();
  const config = {
    owners: [owner],
    channelIds: [],
    permissions: {},
    skills: names,
  };
  const imports = [];
  const disposed = [];
  const modules = new Map();
  for (const name of ["a", "b", "3dprinter"])
    modules.set(name, {
      default: {
        name,
        register(client) {
          const listener = () => {};
          client.on("messageCreate", listener);
          return () => {
            client.off("messageCreate", listener);
            disposed.push(name);
          };
        },
      },
    });
  const options = {
    discover: async () =>
      new Map([...modules.keys()].map((name) => [name, name])),
    load: async (name) => {
      imports.push(name);
      return modules.get(name);
    },
  };
  const manager = new SkillManager(client, config, options);
  return { client, config, manager, imports, disposed, modules, options };
}

async function restart(manager, names) {
  await manager.stop();
  manager.config.skills = names;
  await manager.start();
}

function message(content, authorId = owner) {
  const replies = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guildId: "guild",
    channelId: "channel",
    replies,
    reply: async (payload) => replies.push(payload),
  };
}

test("available skills are not imported or activated automatically", async () => {
  const { manager, imports, client } = setup();
  assert.deepEqual(validateBotConfig({}).skills, []);
  await manager.start();
  assert.deepEqual(imports, []);
  assert.equal(client.skills.size, 0);
  const available = await discoverSkills();
  assert.ok(available.has("3dprinter"));
});

test("only selected skills load at startup", async () => {
  const { manager, client, imports } = setup(["b"]);
  await manager.start();
  assert.deepEqual(imports, ["b"]);
  assert.deepEqual([...client.skills.keys()], ["b"]);
  await manager.stop();
});

test("shutdown cleans listeners without changing the configured selection", async () => {
  const { manager, client, config, disposed } = setup(["a"]);
  await manager.start();
  assert.equal(client.listenerCount("messageCreate"), 1);
  await manager.stop();
  assert.equal(client.listenerCount("messageCreate"), 0);
  assert.deepEqual(config.skills, ["a"]);
  assert.deepEqual(disposed, ["a"]);
  await manager.stop();
  assert.deepEqual(disposed, ["a"]);
});

test("repeated startup does not register duplicate skill listeners", async () => {
  const { manager, client, imports } = setup(["a"]);
  await manager.start();
  await manager.start();
  assert.equal(client.listenerCount("messageCreate"), 1);
  assert.deepEqual(imports, ["a"]);
  await manager.stop();
});

test("a skill with no lifecycle cleanup is rejected and listeners are removed", async () => {
  const { manager, modules, client } = setup();
  modules.set("bad", {
    default: {
      name: "bad",
      register(client) {
        client.on("messageCreate", () => {});
      },
    },
  });
  await assert.rejects(manager.activate("bad"), /cleanup/);
  assert.equal(client.listenerCount("messageCreate"), 0);
  assert.equal(client.skills.size, 0);
});

test("missing and invalid skill modules fail without claiming they are loaded", async () => {
  const { manager, modules, client } = setup();
  await assert.rejects(manager.activate("missing"), /finns inte/);
  modules.set("wrong", { default: { name: "another", register() {} } });
  await assert.rejects(manager.activate("wrong"), /filnamnet/);
  assert.equal(client.skills.size, 0);
});

test("startup failure cleans already loaded skills", async () => {
  const { manager, client } = setup(["a", "missing"]);
  await assert.rejects(manager.start(), /finns inte/);
  assert.equal(client.listenerCount("messageCreate"), 0);
  assert.equal(client.skills.size, 0);
});

test("Discord skill listing is read-only and legacy commands cannot change the selection", async () => {
  for (const names of [[], ["a"]]) {
    const { manager, client, config, imports } = setup(names);
    registerInfo(client, config, "0.7.1");
    registerHelp(client, config);
    registerSkillListing(client, config, manager);
    await manager.start();
    const before = JSON.stringify(config);
    const loaded = [...client.skills.keys()];
    const imported = [...imports];
    const send = async (msg) => {
      for (const handler of client.listeners("messageCreate"))
        await handler(msg);
    };
    for (const author of [owner, other]) {
      for (const content of [
        "!skill add b",
        "!skill remove a",
        "!skill add ../a",
        "!skills extra",
      ]) {
        const msg = message(content, author);
        await send(msg);
        assert.equal(msg.replies.length, 0);
      }
    }
    const unauthorized = message("!skills", other);
    await send(unauthorized);
    assert.equal(unauthorized.replies.length, 0);
    for (const extra of [
      { guildId: null },
      { author: { id: owner, bot: true } },
    ]) {
      const ignored = { ...message("!skills"), ...extra };
      await send(ignored);
      assert.equal(ignored.replies.length, 0);
    }
    const listing = message(" !SKILLS ");
    await send(listing);
    assert.equal(listing.replies.length, 1);
    assert.match(listing.replies[0].content, /config\.json/);
    assert.match(listing.replies[0].content, /Starta om boten/);
    assert.doesNotMatch(listing.replies[0].content, /!skill\s/);
    assert.match(
      listing.replies[0].content,
      new RegExp(`a\\s+${names.length ? "aktiv" : "avstängd"}`),
    );
    assert.deepEqual([...client.skills.keys()], loaded);
    assert.deepEqual(imports, imported);
    assert.equal(JSON.stringify(config), before);
    const info = message("!info");
    await send(info);
    assert.match(
      info.replies[0].content,
      names.length ? /Laddade skills\s+a/ : /\(inga\)/,
    );
    await manager.stop();
  }
});

test("manual config edits take effect after restarting and remain untouched by the bot", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "bot-skill-selection-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, "config.json");
  const { client, options, imports, disposed } = setup();
  const original = {
    owners: [owner],
    permissions: {},
    channelIds: [],
    skills: ["a"],
    futureSetting: { enabled: true },
  };
  const firstContent = JSON.stringify(original);
  await writeFile(path, firstContent);
  let manager = new SkillManager(client, await readBotConfig(path), options);
  await manager.start();
  assert.deepEqual([...client.skills.keys()], ["a"]);
  assert.equal(await readFile(path, "utf8"), firstContent);
  const nextContent = JSON.stringify({ ...original, skills: ["b"] });
  await writeFile(path, nextContent);
  assert.deepEqual([...client.skills.keys()], ["a"]);
  await manager.stop();
  manager = new SkillManager(client, await readBotConfig(path), options);
  await manager.start();
  assert.deepEqual([...client.skills.keys()], ["b"]);
  assert.deepEqual(imports, ["a", "b"]);
  assert.deepEqual(disposed, ["a"]);
  const disabledContent = JSON.stringify({ ...original, skills: [] });
  await writeFile(path, disabledContent);
  await manager.stop();
  manager = new SkillManager(client, await readBotConfig(path), options);
  await manager.start();
  assert.equal(client.skills.size, 0);
  assert.equal(client.listenerCount("messageCreate"), 0);
  assert.deepEqual(imports, ["a", "b"]);
  assert.deepEqual(disposed, ["a", "b"]);
  assert.equal(await readFile(path, "utf8"), disabledContent);
});

test("the actual printer skill restarts without duplicate commands", async () => {
  const { manager, modules, client } = setup();
  modules.set("3dprinter", await import("../src/skills/3dprinter.js"));
  await restart(manager, ["3dprinter"]);
  assert.equal(client.listenerCount("messageCreate"), 1);
  await restart(manager, []);
  assert.equal(client.listenerCount("messageCreate"), 0);
  await restart(manager, ["3dprinter"]);
  assert.equal(client.listenerCount("messageCreate"), 1);
  await manager.stop();
});

test("global help follows the active registry and real printer skill replies only once", async () => {
  const { manager, modules, client, config, imports } = setup();
  modules.set("3dprinter", await import("../src/skills/3dprinter.js"));
  modules.get("a").default.namespace = "hello";
  modules.get("a").default.commands = [
    { command: "!hello", description: "Say hello." },
  ];
  registerHelp(client, config);
  const ask = async () => {
    const msg = message("!help", other);
    const count = imports.length;
    for (const handler of client.listeners("messageCreate")) await handler(msg);
    assert.ok(msg.replies.length >= 1);
    assert.equal(imports.length, count);
    const text = msg.replies.map((reply) => reply.content).join("\n");
    assert.equal((text.match(/SkillsBot – kommandon/g) || []).length, 1);
    return text;
  };
  try {
    assert.match(await ask(), /Inga skills är laddade/);
    await restart(manager, ["3dprinter", "a", "b"]);
    const loaded = await ask();
    assert.match(loaded, /Skill: 3dprinter/);
    assert.match(loaded, /!3d status <skrivare\|grupp\|all>/);
    assert.match(loaded, /!3d ams <skrivare\|grupp\|all>/);
    assert.match(loaded, /!hello/);
    assert.match(
      loaded,
      /Skill: b[\s\S]*Denna skill har ingen registrerad kommandohjälp/,
    );
    assert.doesNotMatch(loaded, /addprinter|addgroup/);
    for (const content of ["!3d", "!3d help", "!help 3d"]) {
      const msg = message(content, other);
      for (const handler of client.listeners("messageCreate"))
        await handler(msg);
      assert.equal(msg.replies.length, 1);
      assert.doesNotMatch(msg.replies[0].content, /addprinter|addgroup/);
      assert.match(msg.replies[0].content, /!3d status/);
    }
    await restart(manager, ["a", "b"]);
    const removed = await ask();
    assert.doesNotMatch(removed, /3dprinter|!3d status|!3d ams/);
    assert.match(removed, /!hello/);
    await manager.stop();
    assert.match(await ask(), /Inga skills är laddade/);
  } finally {
    await manager.stop();
  }
});

test("skill prefixes cannot collide with another loaded skill or the main bot", async () => {
  const { manager, modules, client } = setup();
  modules.get("a").default.namespace = "3d";
  await manager.activate("a");
  modules.get("b").default.namespace = "3d";
  await assert.rejects(manager.activate("b"), /används redan/);
  assert.equal(client.skills.size, 1);
  assert.equal(client.listenerCount("messageCreate"), 1);
  for (const namespace of [
    "help",
    "info",
    "skills",
    "skill",
    "Invalid",
    "bad prefix",
  ]) {
    modules.get("b").default.namespace = namespace;
    await assert.rejects(manager.activate("b"), /reserverat eller ogiltigt/);
  }
  await manager.stop();
  modules.get("b").default.namespace = "3d";
  await manager.activate("b");
  assert.equal(client.skills.get("b").namespace, "3d");
  await manager.stop();
});

test("command metadata and permissions must belong to the declaring skill's namespace", async () => {
  const { manager, modules, client } = setup();
  for (const commands of [
    [{ command: "!status", description: "Status." }],
    [{ command: "!ai status", description: "Status." }],
    [{ command: "!b status", description: "Status.", permission: "status" }],
    [{ command: "!b status", description: "Status.", permission: "ai.status" }],
  ]) {
    modules.get("b").default.commands = commands;
    await assert.rejects(manager.activate("b"), /måste börja/);
    assert.equal(client.skills.size, 0);
    assert.equal(client.listenerCount("messageCreate"), 0);
  }
});

test("the manager routes identical status subcommands only to their own skills and leaves help to the core", async () => {
  const { manager, modules, client, config } = setup();
  const handled = [];
  for (const [name, namespace] of [
    ["3dprinter", "3d"],
    ["ai", "ai"],
    ["music", "music"],
  ]) {
    modules.set(name, {
      default: {
        name,
        namespace,
        commands: [
          {
            command: `!${namespace} status`,
            description: "Status.",
            permission: `${namespace}.status`,
          },
        ],
        register(client, context) {
          assert.equal(context.namespace, namespace);
          const listener = async (message) =>
            handled.push([name, message.content]);
          client.on("messageCreate", listener);
          return () => client.off("messageCreate", listener);
        },
      },
    });
    await manager.activate(name);
  }
  registerHelp(client, config);
  for (const content of [
    "!3d status",
    "!AI status",
    "!music status",
    "!status",
    "!3dx status",
    "!info",
    "!3d help",
    "!help",
  ]) {
    const msg = message(content);
    for (const handler of client.listeners("messageCreate")) await handler(msg);
    if (content === "!3d help") {
      assert.equal(msg.replies.length, 1);
      assert.match(msg.replies[0].content, /!3d status/);
      assert.doesNotMatch(msg.replies[0].content, /!ai status|!music status/);
    }
  }
  assert.deepEqual(handled, [
    ["3dprinter", "!3d status"],
    ["ai", "!AI status"],
    ["music", "!music status"],
  ]);
  await restart(manager, ["ai", "music"]);
  const removed = message("!3d status");
  for (const handler of client.listeners("messageCreate"))
    await handler(removed);
  assert.equal(handled.length, 3);
  await manager.stop();
  assert.equal(client.listenerCount("messageCreate"), 1);
});

test("invalid command help is rejected before registering a skill", async () => {
  const { manager, modules, client } = setup();
  let registered = false;
  const valid = { command: "!hello", description: "Say hello." };
  for (const commands of [
    null,
    "help",
    [null],
    [{ ...valid, command: "hello" }],
    [{ ...valid, command: "!hello `bad`" }],
    [{ ...valid, command: "!hello\n!other" }],
    [{ ...valid, description: " " }],
    [{ ...valid, permission: 123 }],
    [{ ...valid, ownerOnly: "yes" }],
  ]) {
    modules.set("bad", {
      default: {
        name: "bad",
        commands,
        register() {
          registered = true;
          return () => {};
        },
      },
    });
    await assert.rejects(manager.activate("bad"), /ogiltig kommandohjälp/);
    assert.equal(registered, false);
    assert.equal(client.skills.size, 0);
    assert.equal(client.listenerCount("messageCreate"), 0);
  }
});

test("namespace routing preserves once listeners and does not consume them on foreign commands", async () => {
  const { manager, modules, client } = setup();
  let calls = 0;
  modules.set("once", {
    default: {
      name: "once",
      register(client) {
        const handler = () => {
          calls++;
        };
        client.once("messageCreate", handler);
        return () => client.off("messageCreate", handler);
      },
    },
  });
  await manager.activate("once");
  client.emit("messageCreate", message("!ai status"));
  assert.equal(calls, 0);
  assert.equal(client.listenerCount("messageCreate"), 1);
  client.emit("messageCreate", message("!once status"));
  assert.equal(calls, 1);
  assert.equal(client.listenerCount("messageCreate"), 0);
  await manager.stop();
});
