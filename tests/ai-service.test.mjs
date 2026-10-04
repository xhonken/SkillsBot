import nodeTest from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateAIConfig,
  readAIConfig,
  readAIEnv,
  AIConfigError,
} from "../src/ai/config.js";
import {
  createAIService,
  requestAI,
  aiErrorMessage,
} from "../src/ai/service.js";

const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn);

function settings(profile = {}, overrides = {}) {
  return validateAIConfig({
    active: "selected",
    profiles: {
      selected: {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:1/v1",
        model: "gpt-oss:20b",
        ...profile,
      },
    },
    ...overrides,
  });
}

function state(baseUrl, provider = "openai-compatible", overrides = {}) {
  const config = settings({ provider, baseUrl }, overrides);
  return {
    settings: config,
    profile: config.profiles.selected,
    apiKey: provider === "openai-compatible" ? null : "secret-api-key",
  };
}

async function server(t, respond) {
  const requests = [];
  const instance = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const record = {
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: JSON.parse(body),
    };
    requests.push(record);
    respond(record, res);
  });
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => {
      instance.close(resolve);
      instance.closeAllConnections();
    });
  });
  return {
    baseUrl: `http://127.0.0.1:${instance.address().port}/v1`,
    requests,
  };
}

function json(res, value) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

test("AI configuration selects one profile and supports optional local authentication", () => {
  assert.equal(validateAIConfig({}).active, null);
  const local = settings();
  assert.equal(local.profiles.selected.apiKeyEnv, null);
  assert.equal(local.timeoutMs, 180000);
  assert.equal(local.profiles.selected.maxOutputTokens, 4096);
  assert.equal(
    settings({ provider: "openai", baseUrl: undefined }).profiles.selected
      .baseUrl,
    "https://api.openai.com/v1",
  );
  assert.equal(
    settings({ provider: "anthropic", baseUrl: undefined }).profiles.selected
      .apiKeyEnv,
    "ANTHROPIC_API_KEY",
  );
  assert.equal(
    settings({ apiKeyEnv: "PRIVATE_AI_KEY" }).profiles.selected.apiKeyEnv,
    "PRIVATE_AI_KEY",
  );
  assert.equal(
    settings({ baseUrl: "http://local.invalid/prefix/v1/" }).profiles.selected
      .baseUrl,
    "http://local.invalid/prefix/v1",
  );
});

test("invalid AI profiles, secrets and limits fail without echoing configuration contents", () => {
  for (const profile of [
    { provider: "unknown" },
    { model: "" },
    { model: "secret-model\nline" },
    { baseUrl: "ftp://secret-host/v1" },
    { baseUrl: "http://user:secret-password@local.invalid/v1" },
    { baseUrl: "http://local.invalid/v1?key=secret-password" },
    { apiKey: "secret-api-key" },
    { apiKeyEnv: "DISCORD_TOKEN" },
    { apiKeyEnv: "invalid-key" },
    { provider: "openai", apiKeyEnv: null },
    { provider: "openai-compatible", baseUrl: undefined },
    { maxOutputTokens: 0 },
  ]) {
    assert.throws(
      () => settings(profile),
      (error) => {
        assert.ok(error instanceof AIConfigError);
        assert.doesNotMatch(
          error.message,
          /secret-password|secret-api-key|secret-model|secret-host/,
        );
        return true;
      },
    );
  }
  for (const overrides of [
    { active: "missing" },
    { maxConcurrent: 0 },
    { timeoutMs: 999 },
    { cooldownMs: -1 },
    { maxQuestionChars: 0 },
    { maxAnswerChars: 99 },
  ])
    assert.throws(() => settings({}, overrides), AIConfigError);
});

test("AI configuration and credentials reload between commands without changing process environment", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "skillsbot-ai-config-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, "ai.json");
  const envPath = join(folder, ".env");
  assert.equal((await readAIConfig(path)).active, null);
  await writeFile(path, '{"profiles": secret-invalid-json}');
  await assert.rejects(readAIConfig(path), (error) => {
    assert.ok(error instanceof AIConfigError);
    assert.doesNotMatch(error.message, /secret-invalid-json/);
    return true;
  });
  await writeFile(path, JSON.stringify(settings({ provider: "openai" })));
  await writeFile(
    envPath,
    "OPENAI_API_KEY=first-key\nDISCORD_TOKEN=private-discord-token\n",
  );
  const inherited = {
    OPENAI_API_KEY: "old-process-key",
    DISCORD_TOKEN: "process-discord-token",
  };
  const service = createAIService({
    loadConfig: () => readAIConfig(path),
    loadEnv: () => readAIEnv(envPath, inherited),
  });
  assert.equal((await service.load()).apiKey, "first-key");
  await writeFile(envPath, "OPENAI_API_KEY=second-key\n");
  assert.equal((await service.load()).apiKey, "second-key");
  await writeFile(path, JSON.stringify(settings({ model: "new-local-model" })));
  const updated = await service.load();
  assert.equal(updated.profile.model, "new-local-model");
  assert.equal(updated.apiKey, null);
  assert.deepEqual(inherited, {
    OPENAI_API_KEY: "old-process-key",
    DISCORD_TOKEN: "process-discord-token",
  });
});

test("local OpenAI-compatible requests use no key and only return final content", async (t) => {
  const mock = await server(t, (_, res) =>
    json(res, {
      model: "actual-gpt-oss",
      choices: [
        {
          message: {
            content: "Ett lokalt svar.",
            reasoning_content: "private-reasoning",
          },
          finish_reason: "stop",
        },
      ],
    }),
  );
  const result = await requestAI(state(mock.baseUrl), "En fråga\n  med indrag");
  assert.equal(result.answer, "Ett lokalt svar.");
  assert.equal(result.model, "actual-gpt-oss");
  const request = mock.requests[0];
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.body.messages[1].content, "En fråga\n  med indrag");
  assert.equal(request.body.stream, false);
  assert.equal(request.body.max_tokens, 4096);
});

test("authenticated compatible servers use their configured key", async (t) => {
  const mock = await server(t, (_, res) =>
    json(res, {
      choices: [
        {
          message: {
            content: [{ type: "text", text: "Svar private-local-key" }],
          },
        },
      ],
    }),
  );
  const selected = state(mock.baseUrl);
  selected.apiKey = "private-local-key";
  const result = await requestAI(selected, "Question");
  assert.equal(result.answer, "Svar [dold API-nyckel]");
  assert.equal(
    mock.requests[0].headers.authorization,
    "Bearer private-local-key",
  );
});

test("AI service refuses an unselected profile or missing credentials before networking", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests++;
    throw new Error("Should not connect");
  };
  const selected = state("http://127.0.0.1:1/v1", "openai");
  selected.apiKey = null;
  await assert.rejects(requestAI(selected, "Q", { fetchImpl }), AIConfigError);
  await assert.rejects(
    requestAI({ ...selected, profile: null }, "Q", { fetchImpl }),
    AIConfigError,
  );
  assert.equal(requests, 0);
});

test("OpenAI Responses requests disable stored responses and ignore reasoning items", async (t) => {
  const mock = await server(t, (_, res) =>
    json(res, {
      model: "resolved-openai-model",
      status: "completed",
      output: [
        {
          type: "reasoning",
          content: [{ type: "output_text", text: "private-reasoning" }],
        },
        {
          type: "message",
          content: [
            { type: "output_text", text: "Part one" },
            { type: "output_text", text: "Part two" },
          ],
        },
      ],
    }),
  );
  const result = await requestAI(state(mock.baseUrl, "openai"), "Question");
  assert.equal(result.answer, "Part one\nPart two");
  assert.equal(result.model, "resolved-openai-model");
  assert.equal(mock.requests[0].url, "/v1/responses");
  assert.equal(mock.requests[0].headers.authorization, "Bearer secret-api-key");
  assert.equal(mock.requests[0].body.input, "Question");
  assert.equal(mock.requests[0].body.max_output_tokens, 4096);
  assert.equal(mock.requests[0].body.store, false);
  assert.equal(mock.requests[0].body.messages, undefined);
});

test("Anthropic Messages requests use its headers, system field and text blocks", async (t) => {
  const mock = await server(t, (_, res) =>
    json(res, {
      model: "resolved-claude-model",
      content: [
        { type: "thinking", thinking: "private-reasoning" },
        { type: "text", text: "Claude answer" },
      ],
      stop_reason: "end_turn",
    }),
  );
  const result = await requestAI(state(mock.baseUrl, "anthropic"), "Question");
  assert.equal(result.answer, "Claude answer");
  assert.equal(mock.requests[0].url, "/v1/messages");
  assert.equal(mock.requests[0].headers["x-api-key"], "secret-api-key");
  assert.equal(mock.requests[0].headers["anthropic-version"], "2023-06-01");
  assert.equal(mock.requests[0].headers.authorization, undefined);
  assert.equal(mock.requests[0].body.messages[0].role, "user");
  assert.equal(mock.requests[0].body.max_tokens, 4096);
  assert.equal(typeof mock.requests[0].body.system, "string");
});

test("token-limited replies and Discord truncation are identified for all providers", async (t) => {
  const variants = {
    openai: {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "x".repeat(200) }],
        },
      ],
      status: "incomplete",
    },
    anthropic: {
      content: [{ type: "text", text: "x".repeat(200) }],
      stop_reason: "max_tokens",
    },
    "openai-compatible": {
      choices: [
        { message: { content: "x".repeat(200) }, finish_reason: "length" },
      ],
    },
  };
  for (const [provider, response] of Object.entries(variants)) {
    const mock = await server(t, (_, res) => json(res, response));
    const result = await requestAI(
      state(mock.baseUrl, provider, { maxAnswerChars: 100 }),
      "Q",
    );
    assert.equal(result.answer.length, 100);
    assert.equal(result.truncated, true);
    assert.equal(result.incomplete, true);
  }
});

test("HTTP errors expose helpful categories without returning API error bodies or retrying", async (t) => {
  for (const [status, code] of [
    [401, "authentication"],
    [403, "authentication"],
    [404, "missing"],
    [429, "rate"],
    [400, "request"],
    [503, "unavailable"],
  ]) {
    const mock = await server(t, (_, res) => {
      res.writeHead(status);
      res.end("secret-api-key private-question upstream-error");
    });
    await assert.rejects(
      requestAI(state(mock.baseUrl), "private-question"),
      (error) => {
        assert.equal(error.code, code);
        assert.doesNotMatch(
          aiErrorMessage(error),
          /secret-api-key|private-question|upstream-error/,
        );
        return true;
      },
    );
    assert.equal(mock.requests.length, 1);
  }
});

test("redirects are rejected before a configured API key can reach another endpoint", async (t) => {
  const mock = await server(t, (_, res) => {
    res.writeHead(302, { Location: "/leak" });
    res.end();
  });
  await assert.rejects(requestAI(state(mock.baseUrl, "openai"), "Q"), {
    code: "network",
  });
  assert.equal(mock.requests.length, 1);
});

test("malformed, oversized and empty AI responses fail clearly", async (t) => {
  for (const [value, code] of [
    ["<html>secret-server-message</html>", "invalid"],
    [
      JSON.stringify({
        choices: [
          { message: { content: "", reasoning_content: "private-reasoning" } },
        ],
      }),
      "empty",
    ],
    [JSON.stringify({ answer: "x".repeat(2 * 1024 * 1024) }), "large"],
  ]) {
    const mock = await server(t, (_, res) => {
      res.writeHead(200);
      res.end(value);
    });
    await assert.rejects(requestAI(state(mock.baseUrl), "Q"), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(
        aiErrorMessage(error),
        /secret-server-message|private-reasoning/,
      );
      return true;
    });
  }
});

test("AI timeout covers both waiting for headers and stalled response bodies", async (t) => {
  for (const headers of [false, true]) {
    const mock = await server(t, (_, res) => {
      if (headers) {
        res.writeHead(200);
        res.flushHeaders();
        res.write('{"choices":');
      }
    });
    const selected = state(mock.baseUrl);
    selected.settings.timeoutMs = 50;
    await assert.rejects(requestAI(selected, "Q"), { code: "timeout" });
    assert.equal(mock.requests.length, 1);
  }
});

test("explicit cancellation stops an AI request", async (t) => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const mock = await server(t, () => started());
  const controller = new AbortController();
  const pending = requestAI(state(mock.baseUrl), "Q", {
    signal: controller.signal,
  });
  await ready;
  controller.abort(new DOMException("Disabled", "AbortError"));
  await assert.rejects(pending, { name: "AbortError" });
});
