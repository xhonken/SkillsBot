import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import ai, { registerAISkill } from "../src/skills/ai.js";
import printerSkill, { registerPrinterSkill } from "../src/skills/3dprinter.js";
import { validateAIConfig, AIConfigError } from "../src/ai/config.js";
import { AIRequestError } from "../src/ai/service.js";
import { registerHelp, registerInfo } from "../src/core.js";
import { SkillManager } from "../src/skill-manager.js";

const owner = "111111111111111111";
const other = "222222222222222222";
const config = { owners: [owner], channelIds: ["channel"], permissions: {} };

function message(content, authorId = owner, extra = {}) {
  const replies = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guildId: "guild",
    channelId: "channel",
    replies,
    reply: async (payload) => replies.push(payload),
    ...extra,
  };
}

function configured(overrides = {}, profileOverrides = {}) {
  const settings = validateAIConfig({
    active: "local",
    profiles: {
      local: {
        provider: "openai-compatible",
        model: "gpt-oss:20b",
        baseUrl: "http://private-host.invalid:11434/v1",
        ...profileOverrides,
      },
    },
    cooldownMs: 0,
    ...overrides,
  });
  return {
    settings,
    profile: settings.profiles[settings.active] ?? null,
    apiKey: null,
  };
}

function setup(t, botConfig = config) {
  const client = new EventEmitter();
  const calls = [];
  let loads = 0;
  const service = {
    load: async () => {
      loads++;
      return configured();
    },
    ask: async (state, question, options) => {
      calls.push({ state, question, options });
      return { answer: "An AI answer.", model: state.profile.model };
    },
  };
  const cleanup = registerAISkill(client, { config: botConfig, service });
  t.after(cleanup);
  return {
    client,
    service,
    calls,
    cleanup,
    handle: client.listeners("messageCreate")[0],
    loads: () => loads,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("AI info describes the selected provider and model without exposing endpoint or key", async (t) => {
  const { handle, calls, service } = setup(t);
  service.load = async () => ({
    ...configured({}, { provider: "openai", apiKeyEnv: "PRIVATE_AI_KEY" }),
    apiKey: "secret-ai-key",
  });
  const msg = message("!ai info", other);
  await handle(msg);
  const text = msg.replies[0].content;
  assert.match(text, /AI – information/);
  assert.match(text, /gpt-oss:20b/);
  assert.match(text, /OpenAI/);
  assert.match(text, /API key present/);
  assert.doesNotMatch(text, /private-host|secret-ai-key|PRIVATE_AI_KEY/);
  assert.equal(calls.length, 0);
  assert.deepEqual(msg.replies[0].allowedMentions, {
    parse: [],
    repliedUser: false,
  });
});

test("AI questions notify the caller before generation and preserve question whitespace", async (t) => {
  const { handle, calls, service } = setup(t);
  const started = deferred();
  const answer = deferred();
  service.ask = async (state, question, options) => {
    calls.push({ state, question, options });
    started.resolve();
    return answer.promise;
  };
  const msg = message(" !AI Q First line\n  second line with  two spaces ");
  const running = handle(msg);
  await started.promise;
  assert.equal(msg.replies.length, 1);
  assert.match(msg.replies[0].content, /AI – working/);
  assert.match(msg.replies[0].content, /Please wait/);
  assert.equal(calls[0].question, "First line\n  second line with  two spaces");
  answer.resolve({ answer: "The completed answer.", model: "resolved-model" });
  await running;
  assert.equal(msg.replies.length, 2);
  assert.match(msg.replies[1].content, /AI – answer/);
  assert.match(msg.replies[1].content, /resolved-model/);
  assert.match(msg.replies[1].content, /The completed answer/);
});

test("AI questions are owner-only by default and configured permission lists allow other users", async (t) => {
  const denied = setup(t);
  const msg = message("!ai q Question", other);
  await denied.handle(msg);
  assert.match(msg.replies[0].content, /do not have permission/);
  assert.equal(denied.loads(), 0);
  assert.equal(denied.calls.length, 0);
  const allowed = setup(t, { ...config, permissions: { "ai.q": [other] } });
  const permitted = message("!ai q Question", other);
  await allowed.handle(permitted);
  assert.equal(allowed.calls.length, 1);
  assert.equal(permitted.replies.length, 2);
});

test("AI info permissions and channel, guild, bot and namespace restrictions apply before loading", async (t) => {
  const { handle, calls, loads } = setup(t, {
    ...config,
    permissions: { "ai.info": [owner] },
  });
  const denied = message("!ai info", other);
  await handle(denied);
  assert.match(denied.replies[0].content, /do not have permission/);
  for (const msg of [
    message("!ai info", owner, { channelId: "another" }),
    message("!ai q Q", owner, { guildId: null }),
    message("!ai q Q", owner, { author: { id: owner, bot: true } }),
    message("!3d info"),
    message("!music q Q"),
    message("!aiinfo"),
    message("!q Q"),
    message("!ai help"),
  ]) {
    await handle(msg);
    assert.equal(msg.replies.length, 0);
  }
  assert.equal(loads(), 0);
  assert.equal(calls.length, 0);
});

test("missing AI selection and missing API key are explained without starting generation", async (t) => {
  const { handle, calls, service } = setup(t);
  for (const selected of [
    configured({ active: null }),
    configured({}, { provider: "anthropic" }),
  ]) {
    service.load = async () => selected;
    const info = message("!ai info");
    await handle(info);
    assert.match(
      info.replies[0].content,
      selected.profile ? /API key missing/ : /None selected/,
    );
    const question = message("!ai q Q");
    await handle(question);
    assert.equal(question.replies.length, 1);
    assert.match(question.replies[0].content, /howto\/AI.md/);
    assert.doesNotMatch(question.replies[0].content, /Please wait/);
  }
  assert.equal(calls.length, 0);
});

test("empty questions, oversized questions and unsupported AI commands give help without API calls", async (t) => {
  const { handle, calls, service } = setup(t);
  service.load = async () => configured({ maxQuestionChars: 5 });
  for (const [content, pattern] of [
    ["!ai q", /!ai q <question>/],
    ["!ai q     ", /!ai q <question>/],
    ["!ai q too long", /at most 5 characters/],
    ["!ai info extra", /without extra arguments/],
    ["!ai unknown", /!ai help/],
  ]) {
    const msg = message(content);
    await handle(msg);
    assert.equal(msg.replies.length, 1);
    assert.match(msg.replies[0].content, pattern);
  }
  assert.equal(calls.length, 0);
});

test("AI errors use a formatted message and never echo provider diagnostics", async (t) => {
  const { handle, service } = setup(t);
  service.load = async () => {
    throw new AIConfigError("secret-key private-endpoint");
  };
  const invalid = message("!ai info");
  await handle(invalid);
  assert.match(invalid.replies[0].content, /AI – error/);
  assert.match(invalid.replies[0].content, /npm run check/);
  assert.doesNotMatch(
    invalid.replies[0].content,
    /secret-key|private-endpoint/,
  );
  service.load = async () => configured();
  service.ask = async () => {
    throw new AIRequestError("authentication");
  };
  const refused = message("!ai q Q");
  await handle(refused);
  assert.equal(refused.replies.length, 2);
  assert.match(refused.replies[1].content, /AI – error/);
  assert.match(refused.replies[1].content, /denied access/);
});

test("long AI answers split into balanced code boxes and suppress mentions", async (t) => {
  const { handle, service } = setup(t);
  service.ask = async () => ({
    answer: "Long answer @everyone ```quote```\n".repeat(300),
    model: "gpt-oss:20b",
    truncated: true,
    incomplete: true,
  });
  const msg = message("!ai q Q");
  await handle(msg);
  assert.ok(msg.replies.length > 3);
  for (const payload of msg.replies) {
    assert.ok(payload.content.length <= 1900);
    assert.equal(payload.content.split("```").length - 1, 2);
    assert.doesNotMatch(payload.content, /@everyone/);
    assert.deepEqual(payload.allowedMentions, {
      parse: [],
      repliedUser: false,
    });
  }
  const text = msg.replies.map((r) => r.content).join("\n");
  assert.match(text, /The answer was shortened/);
  assert.match(text, /token limit/);
});

test("AI cooldown prevents a second paid request without affecting info", async (t) => {
  const { handle, calls, service } = setup(t);
  service.load = async () => configured({ cooldownMs: 5000 });
  await handle(message("!ai q First"));
  const duplicate = message("!ai q Second");
  await handle(duplicate);
  assert.match(duplicate.replies[0].content, /Wait a few seconds/);
  assert.equal(calls.length, 1);
  const info = message("!ai info");
  await handle(info);
  assert.match(info.replies[0].content, /AI – information/);
});

test("in-flight questions enforce per-user and global limits without queueing extra requests", async (t) => {
  const { handle, calls, service } = setup(t, {
    ...config,
    permissions: { "ai.q": [] },
  });
  service.load = async () => configured({ maxConcurrent: 1 });
  const started = deferred();
  const answer = deferred();
  service.ask = async () => {
    calls.push("question");
    started.resolve();
    return answer.promise;
  };
  const running = handle(message("!ai q First"));
  await started.promise;
  const same = message("!ai q Second");
  await handle(same);
  assert.match(same.replies[0].content, /previous AI question/);
  const concurrent = message("!ai q Another", other);
  await handle(concurrent);
  assert.match(concurrent.replies[0].content, /other questions/);
  assert.equal(calls.length, 1);
  answer.resolve({ answer: "Finished", model: "gpt-oss:20b" });
  await running;
  const next = message("!ai q Now", other);
  await handle(next);
  assert.equal(calls.length, 2);
});

test("unloading AI aborts pending requests and prevents late replies", async (t) => {
  const { handle, service, cleanup, client } = setup(t);
  const started = deferred();
  const answer = deferred();
  let signal;
  service.ask = async (_, __, options) => {
    signal = options.signal;
    started.resolve();
    return answer.promise;
  };
  const msg = message("!ai q Q");
  const running = handle(msg);
  await started.promise;
  cleanup();
  assert.equal(signal.aborted, true);
  assert.equal(client.listenerCount("messageCreate"), 0);
  answer.resolve({ answer: "Late answer", model: "gpt-oss:20b" });
  await running;
  assert.equal(msg.replies.length, 1);
  await handle(message("!ai info"));
});

test("a failed Discord acknowledgement does not start an AI API request", async (t) => {
  const { handle, calls } = setup(t);
  const msg = message("!ai q Q", owner, {
    reply: async () => {
      throw new Error("Discord unavailable");
    },
  });
  const logged = [];
  const previous = console.error;
  console.error = (value) => logged.push(value);
  try {
    await handle(msg);
  } finally {
    console.error = previous;
  }
  assert.equal(calls.length, 0);
  assert.ok(logged.includes("AI command could not send a Discord reply."));
});

test("AI and printer skills coexist with help reflecting the configured selection after restart", async (t) => {
  const client = new EventEmitter();
  client.skills = new Map();
  const botConfig = { ...config, skills: ["3dprinter", "ai"] };
  let aiLoads = 0;
  let printerLoads = 0;
  const modules = new Map([
    [
      "ai",
      {
        default: {
          ...ai,
          register: (client, context) =>
            registerAISkill(client, {
              ...context,
              service: {
                load: async () => {
                  aiLoads++;
                  return configured();
                },
              },
            }),
        },
      },
    ],
    [
      "3dprinter",
      {
        default: {
          ...printerSkill,
          register: (client, context) =>
            registerPrinterSkill(client, {
              ...context,
              cooldownMs: 0,
              service: {
                load: async () => {
                  printerLoads++;
                  return { printers: {}, groups: {} };
                },
              },
            }),
        },
      },
    ],
  ]);
  const manager = new SkillManager(client, botConfig, {
    discover: async () => new Map([...modules.keys()].map((id) => [id, id])),
    load: async (id) => modules.get(id),
  });
  t.after(() => manager.stop());
  registerHelp(client, botConfig);
  registerInfo(client, botConfig, "0.6.0");
  await manager.start();
  const ask = async (content) => {
    const msg = message(content);
    for (const handler of client.listeners("messageCreate"))
      await handler.call(client, msg);
    return msg;
  };
  const help = await ask("!help");
  const text = help.replies.map((r) => r.content).join("\n");
  assert.match(text, /!ai info/);
  assert.match(text, /!ai q <question>/);
  assert.match(text, /!3d status/);
  for (const content of ["!ai", "!ai help", "!help ai"]) {
    const msg = await ask(content);
    assert.equal(msg.replies.length, 1);
    assert.match(msg.replies[0].content, /Skill: ai/);
    assert.doesNotMatch(msg.replies[0].content, /!3d/);
  }
  await ask("!ai info");
  assert.equal(aiLoads, 1);
  assert.equal(printerLoads, 0);
  await ask("!3d printers");
  assert.equal(printerLoads, 1);
  assert.equal(aiLoads, 1);
  assert.match((await ask("!info")).replies[0].content, /3dprinter, ai/);
  await manager.stop();
  botConfig.skills = ["3dprinter"];
  await manager.start();
  assert.equal((await ask("!ai info")).replies.length, 0);
  assert.doesNotMatch(
    (await ask("!help")).replies.map((r) => r.content).join("\n"),
    /!ai info/,
  );
  await manager.stop();
  botConfig.skills = ["3dprinter", "ai"];
  await manager.start();
  assert.equal((await ask("!ai help")).replies.length, 1);
});
