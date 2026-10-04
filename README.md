# SkillsBot

A modular Discord bot. Install the **main bot** first, then choose the **skills** you want. Every skill is disabled by default and must be enabled manually in `config.json`, followed by a restart.

| Part             | Responsibilities                                                                               | Start here                                       |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Main bot         | Discord login, owners, allowed channels, help, version, and loading your selected skills.      | [Main-bot installation](docs/GETTING_STARTED.md) |
| 3D printer skill | Printer status/progress, remaining time, errors, groups, and multi-unit Bambu AMS information. | [Printer setup](howto/PRINTERS.md)               |
| AI skill         | Questions to a local compatible AI server, OpenAI, or Claude using your own configuration.     | [AI setup](howto/AI.md)                          |

The main bot works without printers or AI. Replies use labelled code blocks and tables. Bot replies and printer-wizard prompts are currently Swedish; documentation is English.

## Installation

For a first installation, follow [Install and Configure the Main Bot](docs/GETTING_STARTED.md). It walks through software installation, creating/inviting the Discord bot, obtaining IDs and a token, setup, and verification. Use Node.js 24 LTS and Git; Node.js 20.19+ is the project minimum.

Once you have prepared Discord, the terminal commands are:

```bash
git clone https://github.com/xhonken/SkillsBot.git
cd SkillsBot
npm ci
npm run setup
npm run check
npm start
```

Setup asks only for the Discord token (hidden input), owner IDs, and allowed channels. It creates private configuration with no enabled skills, no printers, and no selected AI. In Discord, verify `!help` and `!info` before configuring optional skills.

## Main-Bot Commands

| Command   | Purpose                                                      |
| --------- | ------------------------------------------------------------ |
| `!help`   | Show the main commands and the commands of loaded skills.    |
| `!info`   | Show version and loaded skills; owners only.                 |
| `!skills` | List available skills and their current status; owners only. |

Owners, channel restrictions, file editing, backups, and restart rules are explained in [Configuration Basics](docs/CONFIGURATION.md). Enable a skill by adding its module ID to the existing `skills` list in private `config.json`; remove its ID to disable it. Restart after either change. Discord cannot change the selection.

## Optional Skill Commands

Skill commands exist only when that skill is enabled. Configure it using its separate guide:

| Skill                            | Module ID in `config.json` | Discord examples                                               |
| -------------------------------- | -------------------------- | -------------------------------------------------------------- |
| [3D printers](howto/PRINTERS.md) | `3dprinter`                | `!3d printers`, `!3d status bambu1`, `!3d ams all`, `!3d help` |
| [AI](howto/AI.md)                | `ai`                       | `!ai info`, `!ai q Say hello`, `!ai help`                      |

The printer guide covers adding/removing devices and groups. Connections use Bambu MQTT, Moonraker, OctoPrint, or PrusaLink; see [Compatibility](docs/COMPATIBILITY.md) for supported brand/API combinations. Printer commands monitor rather than control prints.

The AI guide provides separate examples for local models, OpenAI, and Claude. AI questions are owner-only by default. SkillsBot connects to an existing model API; it does not host models. Selecting a model or adding device settings does not enable a skill.

## Keep It Running and Maintain It

- [Linux automatic startup and updates](docs/DEPLOYMENT.md): run after reboot on a Raspberry Pi/Linux server, inspect logs, and restart the service.
- [All user guides](howto/README.md): main-bot and skill documentation in one index.
- [Write a skill](docs/SKILLS.md): add trusted local modules with separate command prefixes.
- [Contribute and test](CONTRIBUTING.md): development checks and conventions.

Keep `.env`, `config.json`, `printers.json`, `ai.json`, and `.backups/` private. They are ignored by Git; public templates contain placeholders. Preserve existing private settings when updating or adding another device/profile.

## License

MIT. See [LICENSE](LICENSE). Bundled public Bambu printer CA certificates are documented in [certs/README.md](certs/README.md).
