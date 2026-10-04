import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { initializeFiles, setupBot } from "../scripts/setup.mjs";
import { renderService } from "../scripts/service-generate.mjs";

const owner = "111111111111111111";
const channel = "222222222222222222";
const token = "example-discord-token-for-automated-tests";

async function folder(t) {
  const root = await mkdtemp(join(tmpdir(), "skillsbot-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("initialization creates empty private configurations without overwriting existing files", async (t) => {
  const root = await folder(t);
  assert.equal((await initializeFiles(root)).length, 4);
  const printers = JSON.parse(await readFile(join(root, "printers.json")));
  assert.deepEqual(printers, { printers: {}, groups: {} });
  assert.equal(JSON.parse(await readFile(join(root, "ai.json"))).active, null);
  const existing = "# Existing credentials\nDISCORD_TOKEN=" + token + "\n";
  await writeFile(join(root, ".env"), existing);
  assert.deepEqual(await initializeFiles(root), []);
  assert.equal(await readFile(join(root, ".env"), "utf8"), existing);
  for (const name of ["config.json", "printers.json", "ai.json", ".env"])
    assert.equal((await stat(join(root, name))).mode & 0o777, 0o600);
});

test("setup hides the token prompt, selects skills and channels, and preserves unrelated secrets", async (t) => {
  const root = await folder(t);
  await initializeFiles(root);
  const previous =
    "BAMBU_ACCESS_CODE=printer-test-secret\nOPENAI_API_KEY=ai-test-secret\n";
  await writeFile(join(root, ".env"), previous);
  const answers = [token, owner + ", " + owner, channel, "3dprinter, ai"];
  const logs = [];
  const config = await setupBot(root, {
    prompt: async (question, options) => {
      if (question.startsWith("Discord bot token"))
        assert.equal(options.hidden, true);
      return answers.shift();
    },
    log: (line) => logs.push(line),
  });
  assert.deepEqual(config.owners, [owner]);
  assert.deepEqual(config.channelIds, [channel]);
  assert.deepEqual(config.skills, ["3dprinter", "ai"]);
  const content = await readFile(join(root, ".env"), "utf8");
  assert.ok(content.startsWith(previous));
  assert.equal(parseEnv(content).DISCORD_TOKEN, token);
  assert.doesNotMatch(
    logs.join("\n"),
    /example-discord-token|printer-test-secret|ai-test-secret/,
  );
  assert.doesNotMatch(
    await readFile(join(root, "config.json"), "utf8"),
    /token|secret/,
  );
});

test("reconfiguration retains existing token, owners, permissions and printer configuration", async (t) => {
  const root = await folder(t);
  await initializeFiles(root);
  const config = {
    owners: [owner],
    channelIds: [channel],
    skills: ["ai"],
    permissions: { "ai.q": [owner] },
  };
  await writeFile(join(root, "config.json"), JSON.stringify(config));
  await writeFile(join(root, ".env"), "DISCORD_TOKEN=" + token + "\n");
  const printerBefore = await readFile(join(root, "printers.json"), "utf8");
  const result = await setupBot(root, {
    prompt: async () => "",
    log: () => {},
  });
  assert.deepEqual(result, config);
  assert.equal(
    parseEnv(await readFile(join(root, ".env"), "utf8")).DISCORD_TOKEN,
    token,
  );
  assert.equal(
    await readFile(join(root, "printers.json"), "utf8"),
    printerBefore,
  );
});

test("invalid IDs and unknown skills leave existing settings untouched", async (t) => {
  for (const answers of [
    [token, "975510"],
    [token, owner, "all", "does-not-exist"],
  ]) {
    const root = await folder(t);
    await initializeFiles(root);
    const before = await Promise.all(
      [".env", "config.json"].map((name) => readFile(join(root, name), "utf8")),
    );
    await assert.rejects(
      setupBot(root, { prompt: async () => answers.shift(), log: () => {} }),
      /full Discord IDs|listed skill names/,
    );
    assert.deepEqual(
      await Promise.all(
        [".env", "config.json"].map((name) =>
          readFile(join(root, name), "utf8"),
        ),
      ),
      before,
    );
  }
});

test("setup refuses to overwrite edits made while the user answers prompts", async (t) => {
  const root = await folder(t);
  await initializeFiles(root);
  const answers = [token, owner, "all", "3dprinter"];
  const external = "# Changed elsewhere\nDISCORD_TOKEN=another-example-token\n";
  await assert.rejects(
    setupBot(root, {
      prompt: async () => {
        if (answers.length === 1) await writeFile(join(root, ".env"), external);
        return answers.shift();
      },
      log: () => {},
    }),
    /changed during setup/,
  );
  assert.equal(await readFile(join(root, ".env"), "utf8"), external);
});

test("service generation handles paths with spaces and percent signs and refuses root", async () => {
  const template = await readFile(
    new URL("../deploy/skillsbot.service", import.meta.url),
    "utf8",
  );
  const settings = {
    user: "botuser",
    root: "/srv/My Bot%data",
    node: "/opt/node/bin/node",
  };
  const service = renderService(template, settings);
  assert.match(service, /User=botuser/);
  assert.match(service, /WorkingDirectory=\/srv\/My Bot%%data\n/);
  assert.match(service, /EnvironmentFile=\/srv\/My Bot%%data\/\.env\n/);
  assert.match(
    service,
    /ExecStart="\/opt\/node\/bin\/node" "\/srv\/My Bot%%data\/src\/bot.js"/,
  );
  assert.doesNotMatch(
    service,
    /@USER@|@WORKDIR@|@ROOT@|@NODE@|@ENV@|@BOT@|@READY@/,
  );
  assert.throws(
    () => renderService(template, { ...settings, user: "root" }),
    /regular user/,
  );
});
