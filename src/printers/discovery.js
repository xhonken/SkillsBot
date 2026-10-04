import { createSocket } from "node:dgram";
import { lookup } from "node:dns/promises";
import { StatusError } from "./status.js";

const request = Buffer.from(
  'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1990\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n',
);

export function parseDiscovery(payload) {
  if (payload.length > 16384) return null;
  const lines = payload.toString("utf8").split(/\r?\n/);
  if (!/^HTTP\/1\.1 200\b/.test(lines[0])) return null;
  const headers = new Map();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (headers.has(key)) return null;
    headers.set(key, line.slice(colon + 1).trim());
  }
  const deviceId = headers
    .get("usn")
    ?.replace(/^uuid:/i, "")
    .split("::")[0];
  if (!deviceId || !/^[a-zA-Z0-9_-]{1,64}$/.test(deviceId)) return null;
  const displayName = headers.get("devname.bambu.com");
  return {
    deviceId,
    ...(displayName &&
    displayName.length <= 80 &&
    !/[\x00-\x1f\x7f]/.test(displayName)
      ? { displayName }
      : {}),
  };
}

// Query only the supplied host. No network scanning or printer changes.
export async function discoverBambu(
  host,
  { deviceId, timeoutMs = 2500, port = 1990 } = {},
) {
  let address;
  try {
    ({ address } = await lookup(host, { family: 4 }));
  } catch {
    throw new StatusError(
      "Skrivarens IP-adress eller värdnamn kunde inte hittas.",
    );
  }
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    let done = false;
    const finish = (result, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on("error", () => finish(null));
    socket.on("message", (payload, source) => {
      if (done || source.address !== address) return;
      const found = parseDiscovery(payload);
      if (!found) return;
      if (deviceId && found.deviceId !== deviceId)
        finish(
          null,
          new StatusError(
            "IP-adressen tillhör en skrivare med ett annat serienummer.",
          ),
        );
      else finish(found);
    });
    socket.bind(0, "0.0.0.0", () => {
      if (!done)
        socket.send(request, port, address, (error) => {
          if (error) finish(null);
        });
    });
  });
}
