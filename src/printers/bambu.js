import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT } from "../config.js";
import {
  StatusError,
  number,
  percentage,
  seconds,
  secret,
  state,
  status,
} from "./status.js";

function errorCode(value) {
  const code = number(value);
  return code
    ? Math.trunc(code).toString(16).toUpperCase().padStart(8, "0")
    : null;
}

function trayPresent(ams, unitId, trayId) {
  // Standard four-slot AMS IDs have a documented global slot mapping in Studio.
  const unit = number(unitId);
  const tray = number(trayId);
  if (
    !Number.isInteger(unit) ||
    unit < 0 ||
    unit > 3 ||
    !Number.isInteger(tray) ||
    tray < 0 ||
    tray > 3 ||
    ams.tray_exist_bits === undefined
  )
    return null;
  try {
    const raw = ams.tray_exist_bits;
    const bits =
      typeof raw === "string"
        ? BigInt(`0x${raw.replace(/^0x/i, "")}`)
        : BigInt(raw);
    return Boolean((bits >> BigInt(unit * 4 + tray)) & 1n);
  } catch {
    return null;
  }
}

export function parseBambu(data) {
  const print = data.print;
  if (!print || typeof print.gcode_state !== "string")
    throw new StatusError("Bambu-rapporten saknar utskriftsstatus.");
  const errors = [];
  const code = errorCode(print.print_error);
  if (code)
    errors.push(
      `Bambu felkod ${code} (https://wiki.bambulab.com/en/x1/troubleshooting/hmscode)`,
    );
  for (const item of Array.isArray(print.hms) ? print.hms : []) {
    const attr = errorCode(item.attr) ?? "00000000";
    const hmsCode = errorCode(item.code) ?? "00000000";
    errors.push(`HMS ${attr}-${hmsCode}`);
  }
  const printerState = code ? "error" : state(print.gcode_state);
  const ams = Array.isArray(print.ams?.ams)
    ? print.ams.ams.map((unit) => ({
        id: String(unit.id),
        trays: (Array.isArray(unit.tray) ? unit.tray : []).map((tray) => {
          const present = trayPresent(print.ams, unit.id, tray.id);
          return {
            id: String(tray.id),
            present,
            material: present === false ? null : tray.tray_type || null,
            color: present === false ? null : tray.tray_color || null,
            remainingPercentage:
              present === false ? null : percentage(tray.remain),
          };
        }),
      }))
    : null;
  return status({
    state: printerState,
    percentage: percentage(print.mc_percent),
    remainingSeconds: seconds(
      number(print.mc_remaining_time) === null
        ? null
        : number(print.mc_remaining_time) * 60,
    ),
    error:
      errors.join("; ") ||
      (printerState === "error"
        ? "Bambu rapporterar ett fel utan felkod."
        : null),
    ams,
  });
}

function infoText(value, max = 80) {
  return typeof value === "string" &&
    value.trim() &&
    value.length <= max &&
    !/[\x00-\x1f\x7f]/.test(value)
    ? value.trim()
    : undefined;
}

export function parseBambuInfo(info, deviceId) {
  if (info?.command !== "get_version" || !Array.isArray(info.module))
    throw new StatusError("Bambu svarade inte med giltig modellinformation.");
  const modules = info.module.filter(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );
  if (!modules.length)
    throw new StatusError("Bambu svarade med tom modellinformation.");
  const printer = modules.find((item) => item.name === "ota");
  if (printer?.sn && printer.sn !== deviceId)
    throw new StatusError("Skrivarens rapporterade serienummer stämmer inte.");
  const ams = modules
    .filter(
      (item) =>
        /^AMS\b/i.test(item.product_name ?? "") ||
        /^(?:ams|amslite|n3f)(?:\/\d+)?$/i.test(item.name ?? ""),
    )
    .map((item) => {
      const serial = infoText(item.sn, 64);
      return {
        name: infoText(item.product_name) || "AMS",
        ...(serial && /^[a-zA-Z0-9_-]+$/.test(serial)
          ? { serialNumber: serial }
          : {}),
        ...(infoText(item.sw_ver, 40)
          ? { firmwareVersion: infoText(item.sw_ver, 40) }
          : {}),
      };
    });
  return {
    ...(infoText(printer?.product_name)
      ? { model: infoText(printer.product_name) }
      : {}),
    ...(infoText(printer?.sw_ver, 40)
      ? { firmwareVersion: infoText(printer.sw_ver, 40) }
      : {}),
    ams,
  };
}

// Reports can arrive as partial updates. Arrays of AMS units/trays are keyed by ID.
export function mergeReport(current, update) {
  const result = { ...current };
  for (const [key, value] of Object.entries(update)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (Array.isArray(value)) {
      if (
        value.length &&
        value.every(
          (item) => item && typeof item === "object" && item.id !== undefined,
        )
      ) {
        const previous = Array.isArray(result[key]) ? result[key] : [];
        const byId = new Map(previous.map((item) => [String(item.id), item]));
        for (const item of value)
          byId.set(
            String(item.id),
            mergeReport(byId.get(String(item.id)) ?? {}, item),
          );
        result[key] = [...byId.values()];
      } else result[key] = value;
    } else if (value && typeof value === "object") {
      result[key] = mergeReport(
        result[key] && typeof result[key] === "object" ? result[key] : {},
        value,
      );
    } else result[key] = value;
  }
  return result;
}

export async function fetchBambu(
  printer,
  { connect, env = process.env, wantAMS = false, wantInfo = false } = {},
) {
  const password = secret(printer, "password", env);
  if (!password)
    throw new StatusError("Bambu LAN-kod eller MQTT-lösenord saknas.");
  const timeoutMs = printer.timeoutMs ?? 10000;
  const tls = { rejectUnauthorized: printer.tls?.rejectUnauthorized ?? true };
  if (printer.tls?.servername) tls.servername = printer.tls.servername;
  if (printer.tls?.caFile)
    tls.ca = await readFile(resolve(ROOT, printer.tls.caFile));
  const connectImpl = connect ?? (await import("mqtt")).connect;
  return new Promise((resolveStatus, reject) => {
    let client;
    let done = false;
    let report = {};
    let info;
    let settleTimer;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(settleTimer);
      client?.end(true);
      if (error) reject(error);
      else {
        try {
          resolveStatus({
            ...parseBambu(report),
            ...(wantInfo ? { info } : {}),
          });
        } catch (failure) {
          reject(failure);
        }
      }
    };
    const timer = setTimeout(() => {
      if (wantInfo && !info)
        finish(
          new StatusError(
            "Bambu svarade inte med modell och AMS-information inom tidsgränsen.",
          ),
        );
      else if (report.print?.gcode_state) finish();
      else finish(new StatusError("Bambu MQTT svarade inte inom tidsgränsen."));
    }, timeoutMs);
    try {
      client = connectImpl(`mqtts://${printer.host}:${printer.port ?? 8883}`, {
        username: printer.username ?? "bblp",
        password,
        ...tls,
        connectTimeout: timeoutMs,
        reconnectPeriod: 0,
      });
      const topic = `device/${printer.deviceId}/report`;
      client.on("connect", () => {
        if (done) return;
        client.subscribe(topic, (error, grants) => {
          if (done) return;
          if (error || grants?.some((grant) => grant.qos === 128)) {
            finish(
              new StatusError("Bambu MQTT nekade prenumerationen på status."),
            );
            return;
          }
          // Request a full telemetry report, without any print/control commands.
          const request = {
            pushing: {
              sequence_id: "1",
              command: "pushall",
              version: 1,
              push_target: 1,
            },
          };
          client.publish(
            `device/${printer.deviceId}/request`,
            JSON.stringify(request),
            (error) => {
              if (error)
                finish(new StatusError("Bambu MQTT kunde inte begära status."));
            },
          );
          if (wantInfo && !done)
            client.publish(
              `device/${printer.deviceId}/request`,
              JSON.stringify({
                info: { sequence_id: "2", command: "get_version" },
              }),
              (error) => {
                if (error)
                  finish(
                    new StatusError(
                      "Bambu MQTT kunde inte begära modellinformation.",
                    ),
                  );
              },
            );
        });
      });
      client.on("message", (receivedTopic, payload, packet) => {
        if (done || receivedTopic !== topic || packet?.retain) return;
        if (payload.length > 1024 * 1024) {
          finish(new StatusError("Bambu-statussvaret är för stort."));
          return;
        }
        let update;
        try {
          update = JSON.parse(payload.toString());
        } catch {
          finish(new StatusError("Bambu skickade ogiltig JSON."));
          return;
        }
        if (wantInfo && update?.info?.command === "get_version") {
          try {
            info = parseBambuInfo(update.info, printer.deviceId);
          } catch (error) {
            finish(error);
            return;
          }
        }
        if (
          update?.print &&
          typeof update.print === "object" &&
          !Array.isArray(update.print)
        )
          report = mergeReport(report, { print: update.print });
        const print = report.print;
        const active = ["RUNNING", "PAUSE", "PRINTING", "PAUSED"].includes(
          print?.gcode_state,
        );
        const ready =
          typeof print?.gcode_state === "string" &&
          (!active ||
            (print.mc_percent !== undefined &&
              print.mc_remaining_time !== undefined));
        if (
          ready &&
          (!wantAMS || print.ams !== undefined) &&
          (!wantInfo || info)
        ) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => finish(), 150);
        }
      });
      client.on("error", (error) => {
        const tlsError = /CERT|TLS|SELF_SIGNED|VERIFY/.test(error.code ?? "");
        finish(
          new StatusError(
            tlsError
              ? "Bambu TLS-certifikatet kunde inte verifieras; konfigurera tls.caFile."
              : "Kunde inte ansluta till Bambu MQTT; kontrollera nätverk och LAN-kod.",
          ),
        );
      });
      client.on("close", () => {
        if (!done)
          finish(
            new StatusError(
              "Bambu MQTT-anslutningen stängdes innan status kunde hämtas.",
            ),
          );
      });
    } catch {
      finish(new StatusError("Kunde inte starta Bambu MQTT-anslutningen."));
    }
  });
}
