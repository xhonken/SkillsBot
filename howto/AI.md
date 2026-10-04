# Configure the AI Skill

The `ai` skill supports OpenAI's Responses API, Anthropic's Claude Messages API, and OpenAI-compatible Chat Completions servers such as local Ollama, LM Studio or vLLM. A provider with a different API format needs its own adapter.

## Choose an AI

Open a terminal in the project folder as the bot user:

```bash
cd SkillsBot
```

Edit the existing `ai.json`. If it does not exist, create it from the example:

```bash
test -f ai.json || cp ai.example.json ai.json
chmod 600 ai.json
nano ai.json
```

Set `active` to a profile ID: `"local"`, `"openai"` or `"claude"`. Add further profiles under `profiles` as needed. `null` leaves the skill available without selecting a model. Only the selected profile receives questions; the bot does not switch providers automatically.

### Local GPT-OSS

In the `local` profile, set the server's **API base address** and its exact **model ID**. For an Ollama server, the base normally ends in `/v1`, and a model ID may be `gpt-oss:20b` or `gpt-oss:120b`. Use the actual model installed on your server.

```json
{
  "provider": "openai-compatible",
  "baseUrl": "http://your-ai-server:11434/v1",
  "model": "gpt-oss:20b",
  "apiKeyEnv": null,
  "maxOutputTokens": 4096
}
```

The AI server must be reachable **from the computer running SkillsBot**. `localhost` refers to that computer. The bot calls `/chat/completions` under `baseUrl`; do not put that suffix in the base address. `apiKeyEnv: null` sends no authentication header. If your server requires a key, set a variable name such as `"LOCAL_AI_KEY"` and add it to `.env`.

### An API Listening Only on the AI Server

If the API listens only on its server's loopback interface, an optional SSH connection can forward it to the bot computer:

```bash
ssh -N -L 127.0.0.1:18080:127.0.0.1:8080 your-user@ai-server.invalid
```

Replace the user, server and remote API port with your settings. Keep this session running, and use `http://127.0.0.1:18080/v1` as the profile's `baseUrl`, with the server's actual model ID. This optional SSH arrangement is not a service included with SkillsBot and does not automatically survive reboot.

### OpenAI or Claude

Set the selected profile's `model` to an exact model ID available to your API account. The defaults use `https://api.openai.com/v1` and `https://api.anthropic.com/v1`.

Edit `.env` locally and add the appropriate line:

```dotenv
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

Only the chosen provider's key is needed. Keep `DISCORD_TOKEN` and printer credentials intact. Keys belong in `.env`, referenced through `apiKeyEnv`; never put keys in Discord commands or `ai.json`. Use HTTPS when connecting to a hosted service.

## Activate and Use

```bash
npm run check
```

An owner can enable or disable the skill in Discord:

```text
!skill add ai
!ai info
!ai q Förklara hur en 3D-skrivare fungerar.
!ai help
!skill remove ai
```

`!ai info` shows the selected profile and model; it does not contact the server or claim that the model is loaded. `!ai q` sends a waiting message, then the answer in labelled code blocks. Long answers split into multiple messages. The request is cancelled when the skill is disabled.

Each question is independent. The bot sends that question and its configured `systemPrompt`, without conversation history, other channel messages or printer configuration. API-provider handling of submitted text remains subject to that provider's terms.

AI questions are **owner-only by default**. In `config.json`, set `permissions.ai.q` to an array of allowed Discord user IDs, or `[]` to allow everyone in permitted channels. `ai.info` and help are public by default and can also be restricted. Changes to these access lists require a bot restart.

## Adjust and Troubleshoot

Changes to `ai.json` and AI keys in `.env` apply on the next command without restarting. `timeoutMs` defaults to 180000 (three minutes), `maxConcurrent` to 2 and `cooldownMs` to 5000. A busy bot asks the caller to retry instead of queueing more requests. Lower `maxConcurrent` to 1 for limited local hardware.

Each profile's `maxOutputTokens` limits generation. Reasoning models may need a larger limit to produce a final answer. `maxAnswerChars` limits Discord output; shortened or token-limited responses are labelled. The bot does not automatically retry failed requests or fall back to another provider.

Check `npm run check` for JSON/configuration errors. Authentication errors require checking the key and account access; connection errors require checking the API address and server. Missing text can indicate that reasoning consumed the token limit. Provider error bodies, keys and endpoints are not included in Discord errors.

API references: [OpenAI Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).
