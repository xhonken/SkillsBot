import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { ROOT } from "../config.js";

export class AIConfigError extends Error {}

export const PROVIDERS = Object.freeze({
  openai: "OpenAI",
  anthropic: "Claude / Anthropic",
  "openai-compatible": "OpenAI-kompatibel server",
});

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AIConfigError(`${label} must be an object in ai.json.`);
}

function keys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new AIConfigError(
      `${label} contains an unsupported setting in ai.json; keep API keys in .env.`,
    );
}

function integer(value, fallback, min, max, label) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max)
    throw new AIConfigError(`${label} must be ${min}–${max} in ai.json.`);
  return result;
}

export function validateAIConfig(value) {
  object(value, "AI configuration");
  keys(
    value,
    [
      "active",
      "profiles",
      "systemPrompt",
      "timeoutMs",
      "maxConcurrent",
      "cooldownMs",
      "maxQuestionChars",
      "maxAnswerChars",
    ],
    "AI configuration",
  );
  object(value.profiles ?? {}, "profiles");
  const profiles = {};
  for (const [id, profile] of Object.entries(value.profiles ?? {})) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id))
      throw new AIConfigError(
        "Profile IDs must use lowercase letters, numbers, hyphens or underscores in ai.json.",
      );
    object(profile, "AI profile");
    keys(
      profile,
      ["provider", "model", "baseUrl", "apiKeyEnv", "maxOutputTokens"],
      "AI profile",
    );
    if (!Object.hasOwn(PROVIDERS, profile.provider))
      throw new AIConfigError(
        "Choose openai, anthropic or openai-compatible as provider in ai.json.",
      );
    if (
      typeof profile.model !== "string" ||
      !profile.model.trim() ||
      profile.model.length > 160 ||
      /[\x00-\x1f\x7f]/.test(profile.model)
    )
      throw new AIConfigError("Set a model ID on one line in ai.json.");
    const defaultUrl =
      profile.provider === "openai"
        ? "https://api.openai.com/v1"
        : profile.provider === "anthropic"
          ? "https://api.anthropic.com/v1"
          : null;
    let url;
    if (profile.baseUrl !== undefined && typeof profile.baseUrl !== "string")
      throw new AIConfigError(
        "baseUrl must be an API address string in ai.json.",
      );
    try {
      url = new URL(profile.baseUrl ?? defaultUrl);
    } catch {
      throw new AIConfigError("Set a valid API baseUrl in ai.json.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new AIConfigError(
        "baseUrl must be an HTTP(S) API base address without credentials, query or fragment in ai.json.",
      );
    const apiKeyEnv =
      profile.apiKeyEnv === undefined
        ? profile.provider === "openai"
          ? "OPENAI_API_KEY"
          : profile.provider === "anthropic"
            ? "ANTHROPIC_API_KEY"
            : null
        : profile.apiKeyEnv;
    if (
      (apiKeyEnv !== null &&
        (typeof apiKeyEnv !== "string" ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv) ||
          apiKeyEnv === "DISCORD_TOKEN")) ||
      (profile.provider !== "openai-compatible" && apiKeyEnv === null)
    )
      throw new AIConfigError(
        "apiKeyEnv must name a separate AI key in .env; only openai-compatible allows null.",
      );
    profiles[id] = {
      provider: profile.provider,
      model: profile.model.trim(),
      baseUrl: url.href.replace(/\/+$/, ""),
      apiKeyEnv,
      maxOutputTokens: integer(
        profile.maxOutputTokens,
        4096,
        1,
        32768,
        "maxOutputTokens",
      ),
    };
  }
  const active = value.active ?? null;
  if (
    active !== null &&
    (typeof active !== "string" || !Object.hasOwn(profiles, active))
  )
    throw new AIConfigError("active must match an AI profile ID, or be null.");
  const systemPrompt =
    value.systemPrompt ??
    "You are SkillsBot's AI assistant. Answer clearly and helpfully in English unless the user requests another language. Use plain text and preserve line breaks and indentation when showing code.";
  if (typeof systemPrompt !== "string" || systemPrompt.length > 12000)
    throw new AIConfigError("systemPrompt must be at most 12000 characters.");
  return {
    active,
    profiles,
    systemPrompt,
    timeoutMs: integer(value.timeoutMs, 180000, 1000, 600000, "timeoutMs"),
    maxConcurrent: integer(value.maxConcurrent, 2, 1, 8, "maxConcurrent"),
    cooldownMs: integer(value.cooldownMs, 5000, 0, 60000, "cooldownMs"),
    maxQuestionChars: integer(
      value.maxQuestionChars,
      4000,
      1,
      12000,
      "maxQuestionChars",
    ),
    maxAnswerChars: integer(
      value.maxAnswerChars,
      16000,
      100,
      40000,
      "maxAnswerChars",
    ),
  };
}

export async function readAIConfig(
  path = process.env.AI_CONFIG || resolve(ROOT, "ai.json"),
) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      return validateAIConfig({ active: null, profiles: {} });
    throw new AIConfigError("AI configuration could not be read.");
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AIConfigError("Invalid JSON in ai.json.");
  }
  return validateAIConfig(value);
}

export async function readAIEnv(
  path = process.env.AI_ENV_FILE || resolve(ROOT, ".env"),
  env = process.env,
) {
  try {
    return { ...env, ...parseEnv(await readFile(path, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return { ...env };
    throw new AIConfigError("AI credentials could not be read from .env.");
  }
}
