import { readAIConfig, readAIEnv, AIConfigError } from "./config.js";

export class AIRequestError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function aiErrorMessage(error) {
  if (error instanceof AIConfigError)
    return "AI-inställningarna kunde inte läsas. Kontrollera ai.json och .env lokalt med npm run check.";
  const messages = {
    authentication:
      "AI-tjänsten nekade åtkomst. Kontrollera API-nyckeln och kontots behörighet lokalt.",
    missing: "Modellen eller API-adressen hittades inte. Kontrollera ai.json.",
    rate: "AI-tjänstens anropsgräns eller kvot är nådd. Försök senare eller kontrollera kontot.",
    request:
      "AI-tjänsten kunde inte godkänna anropet. Kontrollera modellnamn och tokeninställning i ai.json.",
    unavailable: "AI-tjänsten är tillfälligt otillgänglig. Försök igen senare.",
    timeout:
      "AI:n hann inte svara inom tidsgränsen. Försök igen eller öka timeoutMs i ai.json för en långsammare lokal modell.",
    invalid: "AI-tjänsten skickade ett svar som boten inte kunde läsa.",
    large: "AI-tjänstens svar var för stort. Minska maxOutputTokens i ai.json.",
    empty:
      "AI:n gav inget textsvar. Kontrollera modellen; en resonerande modell kan behöva högre maxOutputTokens i ai.json.",
    network:
      "AI-tjänsten kunde inte nås. Kontrollera att servern körs och att API-adressen är rätt.",
  };
  return messages[error?.code] ?? "AI-frågan misslyckades. Försök igen senare.";
}

async function responseJSON(response) {
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new AIRequestError("large");
  }
  if (!response.body) throw new AIRequestError("invalid");
  const reader = response.body.getReader();
  const buffers = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AIRequestError("large");
      }
      buffers.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString("utf8"));
  } catch {
    throw new AIRequestError("invalid");
  }
}

function textBlocks(blocks, allowed) {
  return Array.isArray(blocks)
    ? blocks
        .filter((block) => allowed.includes(block?.type))
        .map((block) => block.text ?? block.refusal ?? "")
        .filter((text) => typeof text === "string")
        .join("\n")
    : "";
}

export async function requestAI(
  state,
  question,
  { signal, fetchImpl = fetch } = {},
) {
  const { settings, profile, apiKey } = state;
  if (!profile || (profile.apiKeyEnv && !apiKey))
    throw new AIConfigError(
      "Choose an AI profile and configure its credentials before querying.",
    );
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  let path;
  let body;
  if (profile.provider === "openai") {
    path = "/responses";
    headers.Authorization = `Bearer ${apiKey}`;
    body = {
      model: profile.model,
      instructions: settings.systemPrompt,
      input: question,
      max_output_tokens: profile.maxOutputTokens,
      store: false,
      stream: false,
    };
  } else if (profile.provider === "anthropic") {
    path = "/messages";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: profile.model,
      ...(settings.systemPrompt ? { system: settings.systemPrompt } : {}),
      messages: [{ role: "user", content: question }],
      max_tokens: profile.maxOutputTokens,
      stream: false,
    };
  } else {
    path = "/chat/completions";
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = {
      model: profile.model,
      messages: [
        ...(settings.systemPrompt
          ? [{ role: "system", content: settings.systemPrompt }]
          : []),
        { role: "user", content: question },
      ],
      max_tokens: profile.maxOutputTokens,
      stream: false,
    };
  }
  const timeout = AbortSignal.timeout(settings.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetchImpl(`${profile.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: combined,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const code = [401, 403].includes(response.status)
        ? "authentication"
        : response.status === 404
          ? "missing"
          : response.status === 429
            ? "rate"
            : response.status >= 500
              ? "unavailable"
              : "request";
      throw new AIRequestError(code);
    }
    const data = await responseJSON(response);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new AIRequestError("invalid");
    let answer;
    let incomplete;
    if (profile.provider === "openai") {
      answer = Array.isArray(data?.output)
        ? data.output
            .filter((item) => item?.type === "message")
            .map((item) => textBlocks(item.content, ["output_text", "refusal"]))
            .filter(Boolean)
            .join("\n")
        : "";
      incomplete = data?.status === "incomplete";
    } else if (profile.provider === "anthropic") {
      answer = textBlocks(data?.content, ["text"]);
      incomplete = data?.stop_reason === "max_tokens";
    } else {
      const choice = data?.choices?.[0];
      answer =
        typeof choice?.message?.content === "string"
          ? choice.message.content
          : textBlocks(choice?.message?.content, ["text"]);
      incomplete = choice?.finish_reason === "length";
    }
    answer = answer.trim();
    if (!answer) throw new AIRequestError("empty");
    if (apiKey) answer = answer.replaceAll(apiKey, "[dold API-nyckel]");
    const truncated = answer.length > settings.maxAnswerChars;
    if (truncated) answer = answer.slice(0, settings.maxAnswerChars);
    return {
      answer,
      model:
        typeof data?.model === "string" &&
        data.model.length <= 160 &&
        !/[\x00-\x1f\x7f]/.test(data.model)
          ? apiKey
            ? data.model.replaceAll(apiKey, "[dold API-nyckel]")
            : data.model
          : profile.model,
      incomplete: Boolean(incomplete),
      truncated,
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (timeout.aborted) throw new AIRequestError("timeout");
    if (error instanceof AIRequestError) throw error;
    throw new AIRequestError("network");
  }
}

export function createAIService({
  loadConfig = readAIConfig,
  loadEnv = readAIEnv,
  fetchImpl = fetch,
} = {}) {
  return {
    async load() {
      const settings = await loadConfig();
      const profile = settings.active
        ? settings.profiles[settings.active]
        : null;
      const env = profile?.apiKeyEnv ? await loadEnv() : {};
      const raw = profile?.apiKeyEnv ? env[profile.apiKeyEnv] : null;
      const apiKey = typeof raw === "string" ? raw.trim() : null;
      if (apiKey && /[\r\n]/.test(apiKey))
        throw new AIConfigError("AI key must be on one line in .env.");
      return { settings, profile, apiKey };
    },
    ask(state, question, { signal } = {}) {
      return requestAI(state, question, { signal, fetchImpl });
    },
  };
}
