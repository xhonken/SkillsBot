import test from "node:test";
import assert from "node:assert/strict";
import { parseBambu, mergeReport } from "../src/printers/bambu.js";
import { parseMoonraker } from "../src/printers/moonraker.js";
import { parseOctoprint } from "../src/printers/octoprint.js";
import { parsePrusalink } from "../src/printers/prusalink.js";
import { duration, formatStatus, formatAMS } from "../src/printers/format.js";
import { percentage } from "../src/printers/status.js";

test("Bambu progress is percent and remaining time is converted from minutes to seconds", () => {
  const status = parseBambu({
    print: {
      gcode_state: "RUNNING",
      mc_percent: "42",
      mc_remaining_time: 90,
      print_error: 0,
    },
  });
  assert.equal(status.state, "printing");
  assert.equal(status.percentage, 42);
  assert.equal(status.remainingSeconds, 5400);
  assert.equal(status.error, null);
  assert.match(formatStatus("bambu", status), /42%[\s\S]*1 h 30 min/);
});

test("Bambu idle, paused, completed and failed are distinct", () => {
  for (const [value, expected] of [
    ["IDLE", "idle"],
    ["PAUSE", "paused"],
    ["FINISH", "completed"],
    ["FAILED", "error"],
  ]) {
    assert.equal(parseBambu({ print: { gcode_state: value } }).state, expected);
  }
});

test("Bambu preserves reported print error and HMS codes", () => {
  const status = parseBambu({
    print: {
      gcode_state: "PAUSE",
      print_error: 83935249,
      hms: [{ attr: 0x07000100, code: 0x00020001 }],
    },
  });
  assert.equal(status.state, "error");
  assert.match(status.error, /0500C011/);
  assert.match(status.error, /07000100-00020001/);
});

test("multiple AMS units preserve tray materials, colors, unknown values and zero remaining", () => {
  const status = parseBambu({
    print: {
      gcode_state: "IDLE",
      ams: {
        ams: [
          {
            id: "0",
            tray: [
              { id: "0", tray_type: "PLA", tray_color: "FF0000FF", remain: 65 },
              { id: "1", tray_type: "PETG", remain: -1 },
            ],
          },
          {
            id: "1",
            tray: [
              { id: "0", tray_type: "ABS", remain: 0 },
              { id: "1", tray_type: "TPU" },
            ],
          },
        ],
      },
    },
  });
  assert.equal(status.ams.length, 2);
  assert.equal(status.ams[0].trays[0].remainingPercentage, 65);
  assert.equal(status.ams[0].trays[1].remainingPercentage, null);
  assert.equal(status.ams[1].trays[0].remainingPercentage, 0);
  assert.equal(status.ams[1].trays[1].remainingPercentage, null);
  const text = formatAMS("bambu", status);
  assert.match(text, /```text\nAMS 0\nFack\s+Filament\s+Kvar\s+Färg/);
  assert.match(text, /```text\nAMS 1\n/);
  assert.match(text, /PLA\s+≈65%\s+🟥 Röd/);
  assert.match(text, /ABS\s+≈0%\s+\? Okänd/);
  assert.match(text, /PETG\s+Okänt/);
  assert.equal((text.match(/^```/gm) || []).length, 4);
});

test("unreported AMS is different from no attached AMS", () => {
  assert.match(
    formatAMS("bambu", parseBambu({ print: { gcode_state: "IDLE" } })),
    /rapporterades inte/,
  );
  assert.match(
    formatAMS(
      "bambu",
      parseBambu({ print: { gcode_state: "IDLE", ams: { ams: [] } } }),
    ),
    /Inga AMS/,
  );
});

test("AMS presence bits hide stale filament metadata for physically empty slots", () => {
  const value = parseBambu({
    print: {
      gcode_state: "IDLE",
      ams: {
        tray_exist_bits: "10",
        ams: [
          { id: "0", tray: [{ id: "0", tray_type: "PLA", remain: 80 }] },
          { id: "1", tray: [{ id: "0", tray_type: "PETG", remain: 50 }] },
        ],
      },
    },
  });
  assert.equal(value.ams[0].trays[0].present, false);
  assert.equal(value.ams[0].trays[0].material, null);
  assert.equal(value.ams[1].trays[0].present, true);
  assert.match(formatAMS("bambu", value), /0\s+Tomt\s+–\s+–/);
});

test("Bambu partial updates merge AMS units and trays by ID, with empty arrays clearing", () => {
  const first = {
    print: {
      gcode_state: "RUNNING",
      mc_percent: 10,
      ams: {
        ams: [
          {
            id: "0",
            tray: [
              { id: "0", tray_type: "PLA", remain: 80 },
              { id: "1", tray_type: "PETG" },
            ],
          },
          { id: "1", tray: [] },
        ],
      },
    },
  };
  const updated = mergeReport(first, {
    print: {
      mc_percent: 20,
      ams: { ams: [{ id: "0", tray: [{ id: "0", remain: 75 }] }] },
    },
  });
  assert.equal(updated.print.gcode_state, "RUNNING");
  assert.equal(updated.print.ams.ams.length, 2);
  assert.equal(updated.print.ams.ams[0].tray.length, 2);
  assert.equal(updated.print.ams.ams[0].tray[0].tray_type, "PLA");
  assert.equal(updated.print.ams.ams[0].tray[0].remain, 75);
  assert.equal(first.print.mc_percent, 10);
  assert.deepEqual(
    mergeReport(updated, { print: { ams: { ams: [] } } }).print.ams.ams,
    [],
  );
  assert.equal({}.polluted, undefined);
  mergeReport({}, JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal({}.polluted, undefined);
});

test("Moonraker reports real progress and labels its calculated remaining-time estimate", () => {
  const status = parseMoonraker({
    result: {
      status: {
        webhooks: { state: "ready" },
        print_stats: { state: "printing", print_duration: 1800 },
        virtual_sdcard: { progress: 0.25 },
      },
    },
  });
  assert.equal(status.percentage, 25);
  assert.equal(status.remainingSeconds, 5400);
  assert.match(formatStatus("voron", status), /uppskattning från framsteg/);
});

test("Moonraker startup, zero progress, job errors and shutdown messages", () => {
  const value = (objects) => ({ result: { status: objects } });
  assert.equal(
    parseMoonraker(value({ webhooks: { state: "startup" } })).state,
    "offline",
  );
  assert.equal(
    parseMoonraker(
      value({
        print_stats: { state: "printing", print_duration: 100 },
        display_status: { progress: 0 },
      }),
    ).remainingSeconds,
    null,
  );
  assert.match(
    parseMoonraker(
      value({ print_stats: { state: "error", message: "Heater not heating" } }),
    ).error,
    /Heater not heating/,
  );
  assert.match(
    parseMoonraker(
      value({ webhooks: { state: "shutdown", state_message: "MCU shutdown" } }),
    ).error,
    /MCU shutdown/,
  );
});

test("OctoPrint progress uses percent, seconds and preserves actual error text", () => {
  const status = parseOctoprint({
    state: "Printing",
    progress: { completion: 35, printTimeLeft: 600 },
  });
  assert.equal(status.percentage, 35);
  assert.equal(status.remainingSeconds, 600);
  assert.equal(
    parseOctoprint({
      state: "Operational",
      progress: { completion: null, printTimeLeft: null },
    }).state,
    "idle",
  );
  assert.equal(
    parseOctoprint({ state: "Error", error: "Filament runout" }).error,
    "Filament runout",
  );
});

test("PrusaLink job telemetry and error descriptions", () => {
  const status = parsePrusalink({
    printer: { state: "PRINTING" },
    job: { progress: 70, time_remaining: 1200 },
  });
  assert.equal(status.percentage, 70);
  assert.equal(status.remainingSeconds, 1200);
  assert.match(
    parsePrusalink({
      printer: {
        state: "ATTENTION",
        status_printer: { ok: false, message: "Filament missing" },
      },
    }).error,
    /Filament missing/,
  );
  assert.equal(parsePrusalink({ printer: { state: "READY" } }).state, "idle");
});

test("malformed reports fail rather than fabricate printer state", () => {
  for (const parse of [
    parseBambu,
    parseMoonraker,
    parseOctoprint,
    parsePrusalink,
  ])
    assert.throws(() => parse({}));
  for (const value of [null, undefined, "", -1, 101, "nan", true])
    assert.equal(percentage(value), null);
  assert.equal(percentage(0), 0);
});

test("zero time is known; paused unknown telemetry and printer messages are safe", () => {
  assert.equal(duration(0), "0 min");
  assert.equal(duration(null), "okänd");
  assert.match(
    formatStatus("v1", {
      state: "paused",
      percentage: null,
      remainingSeconds: null,
    }),
    /Pausad[\s\S]*okänd procent[\s\S]*okänd/,
  );
  const text = formatStatus("v1", {
    state: "error",
    error: "@everyone ```bad```\nnew",
  });
  assert.doesNotMatch(text, /@everyone|```bad/);
  assert.equal((text.match(/^```/gm) || []).length, 2);
  assert.match(text, /everyone bad/);
});
