# SkillsBot User Guides

## Main Bot — Start Here

1. [Complete step-by-step installation](../docs/GETTING_STARTED.md): follow the complete numbered walkthrough: download, token, owners/channels, first printer, optional AI, and automatic startup.
2. [Configuration basics](../docs/CONFIGURATION.md): edit the right files, activate skills manually, keep backups, and understand restart rules.
3. [Linux automatic startup](../docs/DEPLOYMENT.md): keep the bot running on a Raspberry Pi or Linux server after logout and reboot.

## Optional Skills

Each skill has its own guide, configuration, and Discord command prefix. Follow either or both after the main bot works:

- [3D printer skill](PRINTERS.md): add a Bambu or supported API printer, create groups, read status/AMS data, and remove printers. Commands start with `!3d`.
- [AI skill](AI.md): select a local model, OpenAI, or Claude, configure credentials, and ask questions. Commands start with `!ai`.

All skills are disabled by default. Activation is manual in `config.json`, followed by a bot restart. Printer/model configuration alone does not enable a skill.

Developers adding modules should read [Writing Skills](../docs/SKILLS.md).
