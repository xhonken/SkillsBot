import { acceptsMessage, hasPermission } from "../permissions.js";
import { parseSkillCommand } from "../commands.js";
import { codeBox, fields, reply, codeText } from "../messages.js";
import { PROVIDERS } from "../ai/config.js";
import { createAIService, aiErrorMessage } from "../ai/service.js";

const commands = [
  {
    command: "!ai help",
    description: "Show AI-skill commands.",
    permission: "ai.help",
  },
  {
    command: "!ai info",
    description: "Show the selected AI profile, provider, and model.",
    permission: "ai.info",
  },
  {
    command: "!ai q <question>",
    description: "Ask the selected AI model a question.",
    permission: "ai.q",
  },
];

export function registerAISkill(
  client,
  { config, service = createAIService() } = {},
) {
  let active = true;
  const pending = new Map();
  const cooldowns = new Map();
  const send = (message, content) =>
    reply(
      {
        reply: (payload) =>
          active ? message.reply(payload) : Promise.resolve(),
      },
      content,
    );
  const onMessage = async (message) => {
    if (!active || !acceptsMessage(message, config)) return;
    const parsed = parseSkillCommand(message.content, "ai");
    if (!parsed || parsed.command === "help") return;
    const { command, args } = parsed;
    try {
      if (!["info", "q"].includes(command)) {
        await send(
          message,
          "Unknown AI command. Use !ai help to see the commands.",
        );
        return;
      }
      if (!hasPermission(message.author.id, `ai.${command}`, config)) {
        await send(message, "You do not have permission to use this command.");
        return;
      }
      if (command === "info" && args.length) {
        await send(message, "Use !ai info without extra arguments.");
        return;
      }
      const question =
        command === "q"
          ? message.content
              .trim()
              .replace(/^!ai\s+q(?:\s+|$)/i, "")
              .trim()
          : "";
      if (command === "q" && !question) {
        await send(
          message,
          "Use !ai q <question>, for example !ai q How does a 3D printer work?",
        );
        return;
      }
      const state = await service.load();
      if (!active) return;
      const { settings, profile, apiKey } = state;
      if (command === "info") {
        await send(
          message,
          codeBox(
            "AI – information",
            fields([
              ["Profile", settings.active || "None selected"],
              ["Provider", profile ? PROVIDERS[profile.provider] : "–"],
              ["Model", profile?.model || "None selected"],
              [
                "Access",
                profile?.apiKeyEnv
                  ? apiKey
                    ? "API key present"
                    : "API key missing"
                  : profile
                    ? "No API key required"
                    : "–",
              ],
              [
                "Status",
                !profile
                  ? "Select a profile in ai.json."
                  : profile.apiKeyEnv && !apiKey
                    ? "Add the AI API key to .env."
                    : "Configured; connection is checked when you ask a question.",
              ],
            ]),
          ),
        );
        return;
      }
      if (!profile) {
        await send(
          message,
          "No AI is selected. Set active in ai.json locally; see howto/AI.md.",
        );
        return;
      }
      if (profile.apiKeyEnv && !apiKey) {
        await send(
          message,
          "The AI profile's API key is missing. Add it to .env locally; see howto/AI.md.",
        );
        return;
      }
      if (question.length > settings.maxQuestionChars) {
        await send(
          message,
          `The question is too long. Use at most ${settings.maxQuestionChars} characters.`,
        );
        return;
      }
      const userId = message.author.id;
      const now = Date.now();
      for (const [id, expires] of cooldowns)
        if (expires <= now) cooldowns.delete(id);
      if (pending.has(userId)) {
        await send(
          message,
          "Your previous AI question is still processing. Wait for its answer.",
        );
        return;
      }
      if (cooldowns.has(userId)) {
        await send(message, "Wait a few seconds before the next AI question.");
        return;
      }
      if (pending.size >= settings.maxConcurrent) {
        await send(
          message,
          "The AI is processing other questions. Try again shortly.",
        );
        return;
      }
      const controller = new AbortController();
      pending.set(userId, controller);
      cooldowns.set(userId, now + settings.cooldownMs);
      try {
        await send(
          message,
          codeBox(
            "AI – working",
            fields([
              ["Model", profile.model],
              ["Status", "Please wait; the answer will arrive shortly."],
            ]),
          ),
        );
        if (!active) return;
        const started = Date.now();
        const result = await service.ask(state, question, {
          signal: controller.signal,
        });
        if (!active) return;
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        const notes = [
          ...(result.truncated
            ? [
                "The answer was shortened for Discord. Narrow your question for a shorter answer.",
              ]
            : []),
          ...(result.incomplete
            ? [
                "The model response reached its token limit. Increase maxOutputTokens in ai.json if needed.",
              ]
            : []),
        ];
        await send(
          message,
          codeBox(
            "AI – answer",
            [
              fields([
                ["Model", result.model || profile.model],
                ["Time", `${elapsed} s`],
              ]),
              "",
              codeText(result.answer),
              ...(notes.length ? ["", ...notes] : []),
            ].join("\n"),
          ),
        );
      } catch (error) {
        if (active)
          await send(message, codeBox("AI – error", aiErrorMessage(error)));
      } finally {
        pending.delete(userId);
      }
    } catch (error) {
      try {
        if (active)
          await send(message, codeBox("AI – error", aiErrorMessage(error)));
      } catch {
        console.error("AI command could not send a Discord reply.");
      }
    }
  };
  client.on("messageCreate", onMessage);
  return () => {
    active = false;
    client.off("messageCreate", onMessage);
    for (const controller of pending.values())
      controller.abort(new DOMException("AI skill disabled", "AbortError"));
    pending.clear();
    cooldowns.clear();
  };
}

export default {
  name: "ai",
  namespace: "ai",
  commands,
  register: registerAISkill,
};
