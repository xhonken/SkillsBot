# SkillsBot

A Discord bot with an owner-controlled skill system. Enable only the modules you want:

- **3D printers:** progress, time remaining, errors, groups, and multi-unit Bambu AMS information.
- **AI:** local OpenAI-compatible models, OpenAI, or Claude with your own credentials.
- **Your own skills:** add modules with separate command prefixes and enable or disable them independently.

Replies use labelled code blocks and tables. Printer monitoring does not start or control prints. AI questions are owner-only by default. Bot replies and printer-wizard prompts are currently Swedish; installation documentation is English.

## Install and Start

Install [Node.js 24 LTS](https://nodejs.org/en/download) and [Git](https://git-scm.com/downloads). Node.js 20.19+ is the minimum. Windows, macOS, and Linux can run the bot; Linux with systemd also supports startup after reboot.

1. Follow [Getting started](docs/GETTING_STARTED.md) to create your Discord application, enable Message Content Intent, invite it, and copy your user ID.
2. Open a terminal and run:

```bash
git clone https://github.com/xhonken/SkillsBot.git
cd SkillsBot
npm ci
npm run setup
npm run check
npm start
```

Setup asks for your bot token (hidden input), owner IDs, allowed channels, and selected skills. It creates private files with an **empty printer list** and **no active AI model**.

Wait for `Logged in as …`, then type `!help` and `!info` in a server text channel. Keep the terminal open; **Ctrl+C** stops the bot. See [Linux automatic startup](docs/DEPLOYMENT.md) to run after reboot.

## Commands

| Command                              | Purpose                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `!help`                              | List main-bot and currently loaded skill commands.           |
| `!info`                              | Show version and active skills; owners only.                 |
| `!skills`                            | List available and active modules; owners only.              |
| `!skill add ai` / `!skill remove ai` | Enable or disable a local module; owners only.               |
| `!3d status <printer\|group\|all>`   | Show progress, time remaining, and errors.                   |
| `!3d ams <printer\|group\|all>`      | Show AMS slots, filament, colors, and estimated amount left. |
| `!3d printers [printer\|group\|all]` | List configured printers and groups.                         |
| `!3d brands` / `!3d help`            | Show supported connection choices or printer commands.       |
| `!ai info` / `!ai help`              | Show the selected AI model or AI commands.                   |
| `!ai q <question>`                   | Ask the configured AI; owners only by default.               |

Skill commands are available while that skill is loaded. Each skill owns its prefix. Example: `!3d ams farm` uses a group named `farm`.

## Add Your Devices and AI

For a Bambu printer, run `npm run printer:add` in the project folder. Enter its IP and LAN code; name, serial, model, firmware, and AMS units are fetched when supported. An optional group can be selected. Other printers use `printers.json` and `printers.example.json`.

The brand catalog includes Bambu Lab, Prusa, Creality, Anycubic, Elegoo, Sovol, QIDI, Flashforge, UltiMaker, and Voron. Connections require Bambu MQTT, Moonraker, OctoPrint, or PrusaLink; a brand name alone does not provide support. See [Compatibility](docs/COMPATIBILITY.md).

For AI, edit private `ai.json` and select a profile with `active`. A local compatible API can use `apiKeyEnv: null`. Hosted APIs use your key in `.env`; paid usage follows provider terms. SkillsBot does not install or host AI models.

- [Add and remove printers](howto/PRINTERS.md)
- [Configure AI](howto/AI.md)
- [Write a skill](docs/SKILLS.md)
- [Contribute and test](CONTRIBUTING.md)

## Configuration and Privacy

| Private file    | Contains                                                     |
| --------------- | ------------------------------------------------------------ |
| `.env`          | Discord token, printer LAN codes, and API keys.              |
| `config.json`   | Owners, allowed channels, selected skills, and access rules. |
| `printers.json` | Your printer connections, metadata, and groups.              |
| `ai.json`       | Your selected model and AI endpoint settings.                |

These files, `.backups/`, and generated service files are ignored by Git. Public examples contain placeholders only. Review staged files before committing; never force-add private files.

Run `npm run setup` again **with the bot stopped** to change core settings. Enter keeps existing values; `none` at the skill prompt loads no skills. Printer and AI settings reload on their next command; owner/channel/permission changes require a restart. Restrict commands with user-ID arrays under `permissions`, such as `"ai.q": ["YOUR_USER_ID"]`. An empty array permits everyone; owners bypass these lists.

If the bot is online but silent, check Message Content Intent, channel permissions, and configured channel IDs. `npm run check` diagnoses configuration errors; [Getting started](docs/GETTING_STARTED.md#troubleshooting) covers first-run problems.

## License

MIT. See [LICENSE](LICENSE). Bundled public Bambu printer CA certificates are documented in [certs/README.md](certs/README.md).
