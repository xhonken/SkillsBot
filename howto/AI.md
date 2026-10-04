# AI Skill: Connect a Model and Ask Questions

Follow the [complete installation guide](../docs/GETTING_STARTED.md) for download, main-bot setup, and optional AI steps first. Confirm `!info` works. This skill connects SkillsBot to an existing AI API; it does not install models or run an AI server.

The module ID is **`ai`**, its commands start with **`!ai`**, and its profiles live in **`ai.json`**. The skill is disabled by default. Choose **one** option below for your first setup.

## 1. Choose Where the AI Runs

| Option                                  | You need                                                                                                                                                                  | Provider setting    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Local/self-hosted AI, including GPT-OSS | A running server exposing an OpenAI-compatible Chat Completions API, its base address, and exact model ID. A key is optional if the server allows unauthenticated access. | `openai-compatible` |
| OpenAI                                  | An API account/key and access to the chosen text model through the Responses API.                                                                                         | `openai`            |
| Claude                                  | A Claude Console API key and access to the chosen model through the Messages API.                                                                                         | `anthropic`         |

API usage may cost money; check your provider account before asking questions. The Discord bot and local AI server may run on separate computers. A Raspberry Pi can run the bot while another machine runs a large model.

A **profile ID**, such as `local`, is your own label. A **model ID** is the exact identifier accepted by the server. The top-level `active` field selects a profile; it does not activate the skill itself.

## 2. Configure One AI Profile

Open private `ai.json` in the project folder using a [plain text editor](../docs/CONFIGURATION.md#open-and-save-files).

Each example below is a complete `ai.json` for **first-time setup**. If you already have profiles, edit or add an entry inside `profiles` and set `active` to its ID, preserving your other entries and settings. Text beginning `REPLACE_WITH_` is a placeholder you must replace.

### Option A: Local GPT-OSS or Another Compatible Server

Obtain these details from your AI server's settings or its administrator:

- **API base address:** for example, `http://your-ai-server:11434/v1` for an Ollama-compatible setup. Replace `your-ai-server` with the reachable IP/hostname and use the server's actual port.
- **Model ID:** exactly as the server reports it. Ollama names may look like `gpt-oss:20b`; another server may expose a different name for the same model.
- **API key requirement:** if none, keep `apiKeyEnv` as JSON `null`, without quotes.

```json
{
  "active": "local",
  "profiles": {
    "local": {
      "provider": "openai-compatible",
      "baseUrl": "http://your-ai-server:11434/v1",
      "model": "REPLACE_WITH_YOUR_MODEL_ID",
      "apiKeyEnv": null,
      "maxOutputTokens": 4096
    }
  },
  "maxConcurrent": 1
}
```

`baseUrl` is the base API address, without `/chat/completions`; SkillsBot adds that path. `localhost` means the **bot computer**, so use the AI server's address if it runs elsewhere. The server must already have the model installed and serve its API.

For a server exposing the compatible model-list endpoint, run this from the bot computer after replacing the hostname/port:

```bash
curl http://your-ai-server:11434/v1/models
```

On Windows Command Prompt, `curl` uses the same command; in PowerShell, use `curl.exe`. The result usually contains model `id` fields: copy the exact ID into `model`. A model list confirms discovery, while the Discord question in step 4 tests generation. Refer to [Ollama's compatibility documentation](https://docs.ollama.com/api/openai-compatibility) for Ollama-specific API behavior.

If your server requires a key, change `apiKeyEnv` to `"LOCAL_AI_KEY"` and add this line to `.env`, replacing the value:

```dotenv
LOCAL_AI_KEY=REPLACE_WITH_YOUR_LOCAL_API_KEY
```

Keep `DISCORD_TOKEN` and other credentials intact. A server exposing a different API format needs an additional adapter.

### Option B: OpenAI

Follow the [official OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart) to create an API key in your OpenAI Platform project. Choose a model ID available to your account that supports text through the Responses API; use the [model documentation](https://developers.openai.com/api/docs/models) to identify the exact ID. Configure any required API billing in your account.

Use this first-time configuration, replacing the model placeholder:

```json
{
  "active": "openai",
  "profiles": {
    "openai": {
      "provider": "openai",
      "model": "REPLACE_WITH_OPENAI_MODEL_ID",
      "apiKeyEnv": "OPENAI_API_KEY",
      "maxOutputTokens": 4096
    }
  }
}
```

Open private `.env` and **add** this line, replacing only the value with your real API key:

```dotenv
OPENAI_API_KEY=REPLACE_WITH_YOUR_OPENAI_API_KEY
```

`apiKeyEnv` is the name of the `.env` variable, not the key itself. Keep `DISCORD_TOKEN` and all existing printer/AI credential lines. SkillsBot supplies the OpenAI API address automatically. A Discord token cannot serve as an AI API key.

### Option C: Claude

In the [Claude Console](https://platform.claude.com), create an API key under **Settings → API keys**. Use a key scoped to the workspace you want to use; SkillsBot does not send a separate workspace-ID header. Follow the [official authentication instructions](https://platform.claude.com/docs/en/manage-claude/authentication) and choose a Messages API model ID available to your account from the [model overview](https://platform.claude.com/docs/en/models/overview).

Use this first-time configuration, replacing the model placeholder:

```json
{
  "active": "claude",
  "profiles": {
    "claude": {
      "provider": "anthropic",
      "model": "REPLACE_WITH_CLAUDE_MODEL_ID",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "maxOutputTokens": 4096
    }
  }
}
```

Add this line to private `.env`, preserving existing entries:

```dotenv
ANTHROPIC_API_KEY=REPLACE_WITH_YOUR_CLAUDE_API_KEY
```

SkillsBot supplies the Claude API address automatically. Put actual keys only in `.env`, never in `ai.json` or Discord commands.

## 3. Activate the AI Skill Manually

Save `ai.json` and `.env`. Stop the bot with **Ctrl+C**, or `sudo systemctl stop skillsbot` for the Linux service. Open private `config.json` and edit its existing `skills` list:

| Desired setup                              | Value                           |
| ------------------------------------------ | ------------------------------- |
| AI only                                    | `"skills": ["ai"]`              |
| AI and an already configured printer skill | `"skills": ["3dprinter", "ai"]` |

Preserve your owners, channels, permissions, and any other enabled skills. Then:

```bash
npm run check
```

Expect `Selected skills` to include `ai` and the AI profile/provider/model to match your configuration. Resolve any missing-key or configuration message before asking a question. This check reads settings; it does not contact the AI API.

Start with `npm start`, or `sudo systemctl start skillsbot` for the Linux service. In Discord, `!info` should list `ai` among loaded skills.

## 4. Test in Discord

As a configured owner, send these separately in an allowed server channel:

```text
!ai info
!ai q Say hello in one short sentence.
!ai help
```

`!ai info` shows the profile, provider, model, and whether a required key is present. It does **not** prove the server is reachable or that the model is loaded.

`!ai q` is the actual connection/generation test. After basic validation, the bot sends **`Please wait; the answer will arrive shortly.`**, then returns the answer in labelled code blocks. Large models can take longer; the default timeout is three minutes. Long answers are split into multiple Discord messages.

AI questions are **owner-only by default**. Each request sends your question and the configured system prompt. There is no conversation history or automatic access to channel messages, printer data, files, or the web. Hosted providers receive the submitted text under their own terms.

## 5. Change Models or Add Profiles Later

To change a model, edit the selected profile's `model` in `ai.json`. To switch providers, keep several named entries inside `profiles` and change `active` to the one you want. The bundled `ai.example.json` shows all three profile types; copy the needed entry rather than overwriting your private settings.

Only the selected profile receives questions. There is no automatic fallback to another provider. `"active": null` leaves the skill loaded with no selected AI; removing `"ai"` from `config.json` → `skills` and restarting disables the skill completely.

Model, profile, and AI-key edits apply on the next command without restarting. Skill activation/removal and access-rule changes require a restart. Stop the bot before disabling it; shutdown cancels outstanding requests.

## 6. Allow Another User to Ask Questions

For an additional bot owner, add their user ID to `owners` as described in [Configuration Basics](../docs/CONFIGURATION.md).

For AI access without ownership, add an `ai.q` entry inside the existing `permissions` object in `config.json`. Its value is a list of full user IDs as strings. For example, this is a **permissions object**, not a complete config file; replace the invented ID:

```json
{
  "ai.q": ["111111111111111111"]
}
```

Preserve other permission entries. Use `"ai.q": []` only if you want everyone in allowed channels to ask questions. Owners bypass these lists. Save, run `npm run check`, and restart. `!ai info` and AI help are public by default and can also be restricted.

## Troubleshooting and Optional Settings

| Problem                              | What to check                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| No `!ai` response                    | Enable `ai` in `config.json` → `skills` manually and restart.                                                   |
| No AI selected                       | `active` must exactly match a key inside `profiles`, rather than the model ID.                                  |
| API key missing                      | Match `apiKeyEnv` to a nonempty, uncommented `.env` entry.                                                      |
| Authentication failure               | Check key validity and provider account/workspace access.                                                       |
| Model not found                      | Replace the placeholder with the exact model ID supported by that server/account.                               |
| Local connection failure             | Check the address/port from the bot computer; `localhost` points to the bot, not another machine.               |
| Request fails on a hosted API        | Check account access/billing and model/API compatibility.                                                       |
| AI busy or previous question pending | Wait for completion and retry; the bot does not queue additional work.                                          |
| Timeout                              | Confirm the server works independently. Increase top-level `timeoutMs` in `ai.json` if generation takes longer. |
| No final text or a token-limit note  | Reasoning may use the token budget; adjust that profile's `maxOutputTokens`.                                    |

Optional top-level settings include `timeoutMs` (default 180000 milliseconds), `maxConcurrent` (default 2), and `cooldownMs` (default 5000 milliseconds). Start with `maxConcurrent: 1` for a local server handling one request at a time. Each profile's `maxOutputTokens` limits generation; `maxAnswerChars` limits Discord output. See the existing template before changing optional settings.

### Advanced: API Available Only on the AI Server

If the API only listens on its server's loopback address, ask the server administrator to provide a connection. One option, from the bot computer, is an SSH tunnel:

```bash
ssh -N -L 127.0.0.1:18081:127.0.0.1:8080 your-user@ai-server.invalid
```

Replace the user, hostname, and remote port with your settings. Leave that session running and use `http://127.0.0.1:18081/v1` as `baseUrl`. This tunnel is separate from the bot and does not automatically survive reboot. Skip this section when your server already exposes a reachable API.
