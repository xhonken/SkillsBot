import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SkillManager,
  registerSkillCommands,
  discoverSkills,
} from "../src/skill-manager.js";
import { validateBotConfig, saveEnabledSkills } from "../src/config.js";
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
  const saves = [];
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
    save: async (names) => {
      saves.push([...names]);
    },
  };
  const manager = new SkillManager(client, config, options);
  return { client, config, manager, saves, imports, disposed, modules };
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
  const { manager, client, imports, saves } = setup(["b"]);
  await manager.start();
  assert.deepEqual(imports, ["b"]);
  assert.deepEqual([...client.skills.keys()], ["b"]);
  assert.deepEqual(saves, []);
  await manager.stop();
});

test("adding and removing skills updates listeners and persistent selection", async () => {
  const { manager, client, config, saves, disposed } = setup();
  await manager.change("add", "a");
  assert.equal(client.listenerCount("messageCreate"), 1);
  assert.deepEqual(config.skills, ["a"]);
  await manager.change("remove", "a");
  assert.equal(client.listenerCount("messageCreate"), 0);
  assert.deepEqual(config.skills, []);
  assert.deepEqual(saves, [["a"], []]);
  assert.deepEqual(disposed, ["a"]);
});

test("duplicate activation does not add listeners; inactive removal is harmless", async () => {
  const { manager, client, saves } = setup();
  assert.ok(await manager.change("add", "a"));
  assert.equal(await manager.change("add", "a"), false);
  assert.equal(client.listenerCount("messageCreate"), 1);
  assert.equal(await manager.change("remove", "missing"), false);
  assert.equal(saves.length, 1);
  await manager.stop();
});

test("concurrent owner edits are serialized without lost updates", async () => {
  const { manager, config, saves } = setup();
  await Promise.all([
    manager.change("add", "a"),
    manager.change("add", "b"),
    manager.change("remove", "a"),
  ]);
  assert.deepEqual(config.skills, ["b"]);
  assert.deepEqual(saves, [["a"], ["a", "b"], ["b"]]);
  await manager.stop();
});

test("failed persistence rolls back activation and leaves an existing skill enabled on removal", async () => {
  const { manager, client, config } = setup();
  const save = manager.save;
  manager.save = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(manager.change("add", "a"), /Ingen skill aktiverades/);
  assert.equal(client.skills.size, 0);
  assert.equal(client.listenerCount("messageCreate"), 0);
  assert.deepEqual(config.skills, []);
  manager.save = save;
  await manager.change("add", "a");
  manager.save = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(manager.change("remove", "a"), /fortfarande aktiv/);
  assert.ok(client.skills.has("a"));
  assert.equal(client.listenerCount("messageCreate"), 1);
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
  await assert.rejects(manager.change("add", "bad"), /cleanup/);
  assert.equal(client.listenerCount("messageCreate"), 0);
  assert.equal(client.skills.size, 0);
});

test("missing and invalid skill modules fail without claiming they are loaded", async () => {
  const { manager, modules, client } = setup();
  await assert.rejects(manager.change("add", "missing"), /finns inte/);
  modules.set("wrong", { default: { name: "another", register() {} } });
  await assert.rejects(manager.change("add", "wrong"), /filnamnet/);
  assert.equal(client.skills.size, 0);
});

test("startup failure cleans already loaded skills", async () => {
  const { manager, client } = setup(["a", "missing"]);
  await assert.rejects(manager.start(), /finns inte/);
  assert.equal(client.listenerCount("messageCreate"), 0);
  assert.equal(client.skills.size, 0);
});

test("the core keeps managing skills and info after all skills are removed", async () => {
  const { manager, client, config, saves } = setup();
  registerInfo(client, config, "0.2.0");
  registerSkillCommands(client, config, manager);
  const manage = client.listeners("messageCreate")[1];
  const unauthorized = message("!skill add a", other);
  await manage(unauthorized);
  assert.equal(unauthorized.replies.length, 0);
  assert.equal(saves.length, 0);
  await manage(message("!skill add a"));
  assert.ok(client.skills.has("a"));
  await manage(message("!skill remove a"));
  assert.equal(client.skills.size, 0);
  assert.equal(client.listenerCount("messageCreate"), 2);
  const info = message("!info");
  await client.listeners("messageCreate")[0](info);
  assert.match(info.replies[0].content, /\(inga\)/);
  const listing = message("!skills");
  await manage(listing);
  assert.match(listing.replies[0].content, /a\s+avstängd/);
  const invalid = message("!skill add ../a");
  await manage(invalid);
  assert.match(invalid.replies[0].content, /Använd/);
});

test("skill selection writes atomically, preserves other settings and uses private file permissions", async () => {
  const folder = await mkdtemp(join(tmpdir(), "bot-skill-selection-"));
  try {
    const path = join(folder, "config.json");
    const original = {
      owners: [owner],
      permissions: { status: [other] },
      channelIds: [],
      skills: [],
      futureSetting: { enabled: true },
    };
    await writeFile(path, JSON.stringify(original));
    await saveEnabledSkills(["3dprinter"], path);
    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(saved, { ...original, skills: ["3dprinter"] });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(folder), ["config.json"]);
  } finally {
    await rm(folder, { recursive: true });
  }
});

test("the actual printer skill can be unloaded and re-enabled without duplicate commands", async () => {
  const { manager, modules, client } = setup();
  modules.set("3dprinter", await import("../src/skills/3dprinter.js"));
  await manager.change("add", "3dprinter");
  assert.equal(client.listenerCount("messageCreate"), 1);
  await manager.change("remove", "3dprinter");
  assert.equal(client.listenerCount("messageCreate"), 0);
  await manager.change("add", "3dprinter");
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
    await manager.change("add", "3dprinter");
    await manager.change("add", "a");
    await manager.change("add", "b");
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
    await manager.change("remove", "3dprinter");
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
  const { manager, modules, client, saves } = setup();
  modules.get("a").default.namespace = "3d";
  await manager.change("add", "a");
  const count = saves.length;
  modules.get("b").default.namespace = "3d";
  await assert.rejects(manager.change("add", "b"), /används redan/);
  assert.equal(client.skills.size, 1);
  assert.equal(client.listenerCount("messageCreate"), 1);
  assert.equal(saves.length, count);
  for (const namespace of [
    "help",
    "info",
    "skills",
    "skill",
    "Invalid",
    "bad prefix",
  ]) {
    modules.get("b").default.namespace = namespace;
    await assert.rejects(
      manager.change("add", "b"),
      /reserverat eller ogiltigt/,
    );
    assert.equal(saves.length, count);
  }
  await manager.change("remove", "a");
  modules.get("b").default.namespace = "3d";
  await manager.change("add", "b");
  assert.equal(client.skills.get("b").namespace, "3d");
  await manager.stop();
});

test("command metadata and permissions must belong to the declaring skill's namespace", async () => {
  const { manager, modules, client, saves } = setup();
  for (const commands of [
    [{ command: "!status", description: "Status." }],
    [{ command: "!ai status", description: "Status." }],
    [{ command: "!b status", description: "Status.", permission: "status" }],
    [{ command: "!b status", description: "Status.", permission: "ai.status" }],
  ]) {
    modules.get("b").default.commands = commands;
    await assert.rejects(manager.change("add", "b"), /måste börja/);
    assert.equal(client.skills.size, 0);
    assert.equal(client.listenerCount("messageCreate"), 0);
    assert.equal(saves.length, 0);
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
    await manager.change("add", name);
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
  await manager.change("remove", "3dprinter");
  const removed = message("!3d status");
  for (const handler of client.listeners("messageCreate"))
    await handler(removed);
  assert.equal(handled.length, 3);
  await manager.stop();
  assert.equal(client.listenerCount("messageCreate"), 1);
});

test("invalid command help is rejected before registering or saving a skill", async () => {
  const { manager, modules, client, saves } = setup();
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
    await assert.rejects(manager.change("add", "bad"), /ogiltig kommandohjälp/);
    assert.equal(registered, false);
    assert.equal(client.skills.size, 0);
    assert.equal(client.listenerCount("messageCreate"), 0);
    assert.equal(saves.length, 0);
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
  await manager.change("add", "once");
  client.emit("messageCreate", message("!ai status"));
  assert.equal(calls, 0);
  assert.equal(client.listenerCount("messageCreate"), 1);
  client.emit("messageCreate", message("!once status"));
  assert.equal(calls, 1);
  assert.equal(client.listenerCount("messageCreate"), 0);
  await manager.stop();
});
