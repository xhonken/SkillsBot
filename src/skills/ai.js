import { acceptsMessage, hasPermission } from "../permissions.js";
import { parseSkillCommand } from "../commands.js";
import { codeBox, fields, reply, codeText } from "../messages.js";
import { PROVIDERS } from "../ai/config.js";
import { createAIService, aiErrorMessage } from "../ai/service.js";

const commands = [
  {
    command: "!ai help",
    description: "Visa AI-skillens kommandon.",
    permission: "ai.help",
  },
  {
    command: "!ai info",
    description: "Visa vald AI-profil, leverantör och modell.",
    permission: "ai.info",
  },
  {
    command: "!ai q <fråga>",
    description: "Ställ en fråga till den valda AI-modellen.",
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
          "Okänt AI-kommando. Använd !ai help för att se kommandona.",
        );
        return;
      }
      if (!hasPermission(message.author.id, `ai.${command}`, config)) {
        await send(message, "Du har inte behörighet att använda kommandot.");
        return;
      }
      if (command === "info" && args.length) {
        await send(message, "Använd !ai info utan extra argument.");
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
          "Använd !ai q <fråga>, till exempel !ai q Hur fungerar en 3D-skrivare?",
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
              ["Profil", settings.active || "Ingen vald"],
              ["Leverantör", profile ? PROVIDERS[profile.provider] : "–"],
              ["Modell", profile?.model || "Ingen vald"],
              [
                "Åtkomst",
                profile?.apiKeyEnv
                  ? apiKey
                    ? "API-nyckel finns"
                    : "API-nyckel saknas"
                  : profile
                    ? "Utan API-nyckel"
                    : "–",
              ],
              [
                "Status",
                !profile
                  ? "Välj en profil i ai.json."
                  : profile.apiKeyEnv && !apiKey
                    ? "Lägg AI-nyckeln i .env."
                    : "Konfigurerad; anslutning kontrolleras vid en fråga.",
              ],
            ]),
          ),
        );
        return;
      }
      if (!profile) {
        await send(
          message,
          "Ingen AI är vald. Välj active i ai.json lokalt; se howto/AI.md.",
        );
        return;
      }
      if (profile.apiKeyEnv && !apiKey) {
        await send(
          message,
          "AI-profilens API-nyckel saknas. Lägg den i .env lokalt; se howto/AI.md.",
        );
        return;
      }
      if (question.length > settings.maxQuestionChars) {
        await send(
          message,
          `Frågan är för lång. Använd högst ${settings.maxQuestionChars} tecken.`,
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
          "Din förra AI-fråga behandlas fortfarande. Vänta på svaret.",
        );
        return;
      }
      if (cooldowns.has(userId)) {
        await send(message, "Vänta några sekunder innan nästa AI-fråga.");
        return;
      }
      if (pending.size >= settings.maxConcurrent) {
        await send(
          message,
          "AI:n arbetar med andra frågor just nu. Försök igen strax.",
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
            "AI – arbetar",
            fields([
              ["Modell", profile.model],
              ["Status", "Dröj kvar, svaret kommer strax."],
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
                "Svaret har kortats för Discord. Minska omfattningen på frågan för ett kortare svar.",
              ]
            : []),
          ...(result.incomplete
            ? [
                "Modellens svar nådde sin tokengräns. Öka maxOutputTokens i ai.json vid behov.",
              ]
            : []),
        ];
        await send(
          message,
          codeBox(
            "AI – svar",
            [
              fields([
                ["Modell", result.model || profile.model],
                ["Tid", `${elapsed} s`],
              ]),
              "",
              codeText(result.answer),
              ...(notes.length ? ["", ...notes] : []),
            ].join("\n"),
          ),
        );
      } catch (error) {
        if (active)
          await send(message, codeBox("AI – fel", aiErrorMessage(error)));
      } finally {
        pending.delete(userId);
      }
    } catch (error) {
      try {
        if (active)
          await send(message, codeBox("AI – fel", aiErrorMessage(error)));
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
