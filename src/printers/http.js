import { createHash, randomBytes } from "node:crypto";
import { StatusError, secret } from "./status.js";

// PrusaLink installations may use Digest authentication instead of an API key.
export function digestAuthorization(challenge, url, username, password) {
  if (!challenge?.startsWith("Digest "))
    throw new StatusError(
      "The printer requires an unsupported authentication method.",
    );
  const fields = Object.fromEntries(
    [...challenge.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map(
      (m) => [m[1], m[2] ?? m[3]],
    ),
  );
  const algorithm = (fields.algorithm ?? "MD5").toUpperCase();
  if (
    !["MD5", "SHA-256"].includes(algorithm) ||
    !fields.realm ||
    !fields.nonce ||
    (fields.qop &&
      !fields.qop
        .split(",")
        .map((v) => v.trim())
        .includes("auth"))
  )
    throw new StatusError(
      "The printer Digest authentication is not supported.",
    );
  const hash = (text) =>
    createHash(algorithm === "MD5" ? "md5" : "sha256")
      .update(text)
      .digest("hex");
  const uri = url.pathname + url.search;
  const cnonce = randomBytes(16).toString("hex");
  const ha1 = hash(`${username}:${fields.realm}:${password}`);
  const ha2 = hash(`GET:${uri}`);
  const response = hash(
    fields.qop
      ? `${ha1}:${fields.nonce}:00000001:${cnonce}:auth:${ha2}`
      : `${ha1}:${fields.nonce}:${ha2}`,
  );
  const quote = (text) => `"${String(text).replace(/["\\]/g, "\\$&")}"`;
  const parts = [
    `username=${quote(username)}`,
    `realm=${quote(fields.realm)}`,
    `nonce=${quote(fields.nonce)}`,
    `uri=${quote(uri)}`,
    `response=${quote(response)}`,
    `algorithm=${algorithm}`,
  ];
  if (fields.qop)
    parts.push("qop=auth", "nc=00000001", `cnonce=${quote(cnonce)}`);
  if (fields.opaque) parts.push(`opaque=${quote(fields.opaque)}`);
  return `Digest ${parts.join(", ")}`;
}

export async function getJson(
  printer,
  path,
  { fetchImpl = fetch, env = process.env } = {},
) {
  const base = printer.url.endsWith("/") ? printer.url : `${printer.url}/`;
  const url = new URL(path.replace(/^\//, ""), base);
  const headers = { Accept: "application/json" };
  const apiKey = secret(printer, "apiKey", env);
  if (apiKey) headers["X-Api-Key"] = apiKey;
  const signal = AbortSignal.timeout(printer.timeoutMs ?? 8000);
  try {
    let response = await fetchImpl(url, { headers, signal, redirect: "error" });
    if (
      response.status === 401 &&
      printer.protocol === "prusalink" &&
      printer.username
    ) {
      const password = secret(printer, "password", env);
      if (!password)
        throw new StatusError("The PrusaLink password is missing.");
      headers.Authorization = digestAuthorization(
        response.headers.get("www-authenticate"),
        url,
        printer.username,
        password,
      );
      await response.body?.cancel();
      response = await fetchImpl(url, { headers, signal, redirect: "error" });
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status))
        throw new StatusError(
          `Access denied (HTTP ${response.status}); check the API key or password.`,
        );
      throw new StatusError(`The status API returned HTTP ${response.status}.`);
    }
    // Bound response size and keep the timeout active while reading the body.
    const reader = response.body.getReader();
    const parts = [];
    let bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw new StatusError("The status response is too large.");
      }
      parts.push(Buffer.from(part.value));
    }
    let value;
    try {
      value = JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch {
      throw new StatusError("The status API returned invalid JSON.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new StatusError("The status API returned an invalid response.");
    return value;
  } catch (error) {
    if (error instanceof StatusError) throw error;
    if (signal.aborted) throw new StatusError("The printer request timed out.");
    throw new StatusError(
      "Could not connect to the printer status API; check the network and TLS.",
    );
  }
}
