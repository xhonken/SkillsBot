import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { fetchBambu } from "../src/printers/bambu.js";
import { fetchMoonraker } from "../src/printers/moonraker.js";
import { fetchOctoprint } from "../src/printers/octoprint.js";
import { fetchPrusalink } from "../src/printers/prusalink.js";
import { getJson } from "../src/printers/http.js";

async function httpServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("HTTP adapters contact the documented read-only endpoints and pass API keys", async (t) => {
  const requests = [];
  const url = await httpServer(t, (req, res) => {
    requests.push([req.method, req.url, req.headers["x-api-key"]]);
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/printer/objects/query?"))
      res.end(
        JSON.stringify({
          result: {
            status: {
              print_stats: { state: "printing", print_duration: 100 },
              virtual_sdcard: { progress: 0.5 },
            },
          },
        }),
      );
    else if (req.url === "/api/job")
      res.end(
        JSON.stringify({
          state: "Printing",
          progress: { completion: 30, printTimeLeft: 1000 },
        }),
      );
    else if (req.url === "/api/v1/status")
      res.end(
        JSON.stringify({
          printer: { state: "PRINTING" },
          job: { progress: 60, time_remaining: 500 },
        }),
      );
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  assert.equal(
    (
      await fetchMoonraker(
        { protocol: "moonraker", url, apiKeyEnv: "TEST_API" },
        { env: { TEST_API: "test-api-key" } },
      )
    ).remainingSeconds,
    100,
  );
  assert.equal(
    (
      await fetchOctoprint({
        protocol: "octoprint",
        url,
        apiKey: "test-api-key",
      })
    ).percentage,
    30,
  );
  assert.equal(
    (
      await fetchPrusalink({
        protocol: "prusalink",
        url,
        apiKey: "test-api-key",
      })
    ).percentage,
    60,
  );
  assert.ok(
    requests.every(
      ([method, , key]) => method === "GET" && key === "test-api-key",
    ),
  );
  assert.match(
    requests[0][1],
    /print_stats.*virtual_sdcard.*display_status.*webhooks/,
  );
});

test("HTTP failures are explicit and do not disclose response bodies", async (t) => {
  const url = await httpServer(t, (req, res) => {
    res.statusCode = Number(req.url.slice(1));
    res.end("password-and-private-server-details");
  });
  for (const code of [401, 403, 500]) {
    await assert.rejects(
      getJson({ url }, `/${code}`),
      (error) =>
        error.message.includes(String(code)) &&
        !error.message.includes("password"),
    );
  }
});

test("invalid JSON, redirects and oversized HTTP responses are rejected", async (t) => {
  const url = await httpServer(t, (req, res) => {
    if (req.url === "/redirect") {
      res.statusCode = 302;
      res.setHeader("Location", "http://external.invalid");
      res.end();
    } else if (req.url === "/large")
      res.end(JSON.stringify({ content: "x".repeat(1024 * 1024 + 1) }));
    else res.end("private-invalid-content");
  });
  await assert.rejects(getJson({ url }, "/invalid"), /ogiltig JSON/);
  await assert.rejects(getJson({ url }, "/large"), /för stort/);
  await assert.rejects(getJson({ url }, "/redirect"), /Kunde inte ansluta/);
});

test("HTTP timeout applies while reading a stalled response body", async (t) => {
  const url = await httpServer(t, (req, res) => {
    res.writeHead(200);
    res.write('{"waiting":');
  });
  await assert.rejects(
    getJson({ url, timeoutMs: 100 }, "/status"),
    /tidsgränsen/,
  );
});

test("missing environment credentials stop before any network request", async () => {
  let calls = 0;
  await assert.rejects(
    getJson(
      { url: "http://printer.invalid", apiKeyEnv: "MISSING" },
      "/status",
      {
        env: {},
        fetchImpl: () => {
          calls++;
        },
      },
    ),
    /MISSING/,
  );
  await assert.rejects(
    fetchBambu(
      { passwordEnv: "MISSING" },
      {
        env: {},
        connect: () => {
          calls++;
        },
      },
    ),
    /MISSING/,
  );
  assert.equal(calls, 0);
});

test("PrusaLink Digest authentication completes a real HTTP challenge", async (t) => {
  let authorized = false;
  const hash = (value) => createHash("md5").update(value).digest("hex");
  const url = await httpServer(t, (req, res) => {
    if (!req.headers.authorization) {
      res.writeHead(401, {
        "WWW-Authenticate":
          'Digest realm="PrusaLink", nonce="test-nonce", qop="auth", algorithm=MD5',
      });
      res.end();
      return;
    }
    const fields = Object.fromEntries(
      [
        ...req.headers.authorization.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g),
      ].map((m) => [m[1], m[2] ?? m[3]]),
    );
    const expected = hash(
      `${hash("maker:PrusaLink:local-password")}:test-nonce:${fields.nc}:${fields.cnonce}:auth:${hash(`GET:${req.url}`)}`,
    );
    authorized = fields.response === expected && fields.username === "maker";
    res.statusCode = authorized ? 200 : 403;
    res.end(JSON.stringify({ printer: { state: "READY" } }));
  });
  const status = await fetchPrusalink(
    {
      protocol: "prusalink",
      url,
      username: "maker",
      passwordEnv: "PRUSA_PASS",
    },
    { env: { PRUSA_PASS: "local-password" } },
  );
  assert.equal(status.state, "idle");
  assert.ok(authorized);
});

function fakeMQTT(messages = [], options = {}) {
  const client = new EventEmitter();
  client.ends = 0;
  client.end = () => {
    client.ends++;
  };
  client.subscribe = (topic, callback) => {
    client.subscribed = topic;
    callback(options.subscribeError, [
      { topic, qos: options.denied ? 128 : 0 },
    ]);
  };
  client.publish = (topic, payload, callback) => {
    client.published = [topic, JSON.parse(payload)];
    (client.requests ??= []).push(client.published);
    callback(options.publishError);
    for (const message of messages)
      setImmediate(() =>
        client.emit(
          "message",
          message.topic ?? client.subscribed,
          Buffer.from(
            typeof message.payload === "string"
              ? message.payload
              : JSON.stringify(message.payload),
          ),
          { retain: message.retain ?? false },
        ),
      );
    if (options.close) setImmediate(() => client.emit("close"));
  };
  const connect = (url, settings) => {
    client.url = url;
    client.settings = settings;
    setImmediate(() =>
      options.error
        ? client.emit("error", options.error)
        : client.emit("connect"),
    );
    return client;
  };
  return { connect, client };
}

const bambu = {
  host: "printer.invalid",
  deviceId: "SERIAL",
  passwordEnv: "LAN_CODE",
  timeoutMs: 500,
};
const env = { LAN_CODE: "local-test-code" };

test("Bambu MQTT subscribes, requests pushall and merges fresh status and AMS reports", async () => {
  const { connect, client } = fakeMQTT([
    { topic: "irrelevant", payload: { print: { gcode_state: "FAILED" } } },
    {
      payload: {
        print: { gcode_state: "RUNNING", mc_percent: 90, mc_remaining_time: 2 },
      },
      retain: true,
    },
    { payload: { print: { gcode_state: "RUNNING", mc_percent: 35 } } },
    {
      payload: {
        print: {
          mc_remaining_time: 10,
          ams: {
            ams: [
              { id: "0", tray: [{ id: "0", tray_type: "PLA", remain: 45 }] },
            ],
          },
        },
      },
    },
  ]);
  const value = await fetchBambu(bambu, { connect, env, wantAMS: true });
  assert.equal(client.url, "mqtts://printer.invalid:8883");
  assert.equal(client.settings.username, "bblp");
  assert.equal(client.settings.password, "local-test-code");
  assert.equal(client.settings.rejectUnauthorized, true);
  assert.equal(client.settings.reconnectPeriod, 0);
  assert.equal(client.subscribed, "device/SERIAL/report");
  assert.equal(client.published[0], "device/SERIAL/request");
  assert.equal(client.published[1].pushing.command, "pushall");
  assert.equal(value.percentage, 35);
  assert.equal(value.remainingSeconds, 600);
  assert.equal(value.ams[0].trays[0].remainingPercentage, 45);
  assert.equal(client.ends, 1);
});

test("MQTT timeout closes the connection without claiming idle", async () => {
  const { connect, client } = fakeMQTT([]);
  await assert.rejects(
    fetchBambu({ ...bambu, timeoutMs: 100 }, { connect, env }),
    /tidsgränsen/,
  );
  assert.equal(client.ends, 1);
});

test("a real partial state can be returned at timeout with missing telemetry unknown", async () => {
  const { connect, client } = fakeMQTT([
    { payload: { print: { gcode_state: "RUNNING" } } },
  ]);
  const value = await fetchBambu(
    { ...bambu, timeoutMs: 100 },
    { connect, env },
  );
  assert.equal(value.state, "printing");
  assert.equal(value.percentage, null);
  assert.equal(value.remainingSeconds, null);
  assert.equal(client.ends, 1);
});

test("MQTT subscribe denial, malformed reports, early close and publish failure terminate cleanly", async () => {
  for (const [messages, options, pattern] of [
    [[], { denied: true }, /nekade prenumerationen/],
    [[{ payload: "invalid-json" }], {}, /ogiltig JSON/],
    [[], { close: true }, /stängdes/],
    [
      [],
      { publishError: new Error("private-credentials") },
      /kunde inte begära/,
    ],
  ]) {
    const { connect, client } = fakeMQTT(messages, options);
    await assert.rejects(fetchBambu(bambu, { connect, env }), pattern);
    assert.equal(client.ends, 1);
  }
});

test("TLS failures report a configuration problem without exposing credentials", async () => {
  const error = Object.assign(new Error("private-local-code"), {
    code: "DEPTH_ZERO_SELF_SIGNED_CERT",
  });
  const { connect, client } = fakeMQTT([], { error });
  await assert.rejects(
    fetchBambu(bambu, { connect, env }),
    (error) =>
      error.message.includes("tls.caFile") &&
      !error.message.includes("private-local-code"),
  );
  assert.equal(client.ends, 1);
});

test("Bambu accepts an explicit TLS certificate name and verification choice", async () => {
  const { connect, client } = fakeMQTT([
    { payload: { print: { gcode_state: "IDLE" } } },
  ]);
  await fetchBambu(
    {
      ...bambu,
      tls: {
        servername: "printer-certificate.invalid",
        rejectUnauthorized: false,
      },
    },
    { connect, env },
  );
  assert.equal(client.settings.servername, "printer-certificate.invalid");
  assert.equal(client.settings.rejectUnauthorized, false);
});

test("Bambu setup waits for fresh status and version reports and only retains AMS accessories", async () => {
  const { connect, client } = fakeMQTT([
    {
      retain: true,
      payload: {
        info: {
          command: "get_version",
          module: [{ name: "ota", sn: "WRONG" }],
        },
      },
    },
    {
      payload: {
        info: {
          command: "get_version",
          module: [
            {
              name: "ota",
              sn: "SERIAL",
              product_name: "Bambu Lab X2D",
              sw_ver: "01.02.00.00",
            },
            {
              name: "n3f/0",
              product_name: "AMS 2 Pro (1)",
              sn: "AMS_ONE",
              sw_ver: "05.00.22.19",
            },
            {
              name: "n3f/1",
              product_name: "AMS 2 Pro (2)",
              sn: "AMS_TWO",
              sw_ver: "05.00.22.19",
            },
            {
              name: "ahb",
              product_name: "Filament Buffer - for X2",
              sn: "BUFFER",
            },
            {
              name: "eef",
              product_name: "Bambu Lab External Exhaust Fan",
              sn: "FAN",
            },
          ],
        },
      },
    },
    {
      payload: {
        print: {
          gcode_state: "IDLE",
          ams: {
            ams: [
              { id: "0", tray: [] },
              { id: "1", tray: [] },
            ],
          },
        },
      },
    },
  ]);
  const report = await fetchBambu(bambu, {
    connect,
    env,
    wantAMS: true,
    wantInfo: true,
  });
  assert.equal(report.state, "idle");
  assert.equal(report.info.model, "Bambu Lab X2D");
  assert.equal(report.info.firmwareVersion, "01.02.00.00");
  assert.deepEqual(
    report.info.ams.map((unit) => unit.serialNumber),
    ["AMS_ONE", "AMS_TWO"],
  );
  assert.doesNotMatch(JSON.stringify(report.info), /BUFFER|FAN/);
  assert.deepEqual(
    client.requests.map(
      ([, request]) => request.pushing?.command || request.info?.command,
    ),
    ["pushall", "get_version"],
  );
  assert.equal(client.ends, 1);
});

test("setup rejects missing version info and serial mismatches instead of saving partial metadata", async () => {
  for (const [messages, pattern] of [
    [
      [{ payload: { print: { gcode_state: "IDLE" } } }],
      /modell och AMS-information/,
    ],
    [
      [
        {
          payload: {
            info: {
              command: "get_version",
              module: [{ name: "ota", sn: "WRONG" }],
            },
          },
        },
      ],
      /serienummer/,
    ],
    [
      [{ payload: { info: { command: "get_version", module: [] } } }],
      /tom modellinformation/,
    ],
  ]) {
    const { connect, client } = fakeMQTT(messages);
    await assert.rejects(
      fetchBambu(
        { ...bambu, timeoutMs: 100 },
        { connect, env, wantInfo: true },
      ),
      pattern,
    );
    assert.equal(client.ends, 1);
  }
});
