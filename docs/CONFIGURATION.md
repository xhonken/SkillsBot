# Configuration Basics

These instructions apply after [main-bot setup](GETTING_STARTED.md). Keep a private backup before editing settings. In your project folder, create a `.backups` folder and a dated subfolder, then copy `.env`, `config.json`, `printers.json`, and `ai.json` into it using your file manager.

## Which File Does What?

| File            | Responsibility                                                      | Guide                                   |
| --------------- | ------------------------------------------------------------------- | --------------------------------------- |
| `config.json`   | Main bot: owners, allowed channels, enabled skills, command access. | This page                               |
| `.env`          | Credentials: Discord token, printer LAN codes, AI API keys.         | Main setup and the relevant skill guide |
| `printers.json` | 3D skill: printer connections and printer groups.                   | [Printers](../howto/PRINTERS.md)        |
| `ai.json`       | AI skill: profiles, selected model, and AI settings.                | [AI](../howto/AI.md)                    |

Files ending in `.example.json` are reference templates. The running bot reads the private files above; changing a template does not change your bot.

## Open and Save Files

Use a plain text editor. On Windows, use Notepad and show filename extensions in File Explorer. On macOS, use a code editor or TextEdit with **Format → Make Plain Text**. Save the original filename, such as `config.json`, rather than `config.json.txt`. Dotfiles such as `.env` may be hidden; enable hidden-file display in your file manager.

On Linux/Pi, from the project terminal:

```bash
nano config.json
```

In nano, save with **Ctrl+O**, Enter; exit with **Ctrl+X**. Replace the filename to edit another file.

JSON uses double quotes, commas between entries, and no comma after the last entry. It does not accept comments. Keep braces and brackets balanced. After saving JSON, run `npm run check`; fix any error before restarting.

## Owners, Channels, and Skills

This complete example shows two owners, one allowed channel, and no skills. The IDs are invented: replace them with your own before use. When editing an existing file, preserve your other settings.

```json
{
  "owners": ["111111111111111111", "222222222222222222"],
  "channelIds": ["333333333333333333"],
  "skills": [],
  "permissions": {}
}
```

- Add or remove owner IDs under `owners`; at least one owner is required.
- `"channelIds": []` allows all accessible server channels. Add channel IDs to restrict replies.
- `"skills": []` disables every skill. Use `["3dprinter"]`, `["ai"]`, or `["3dprinter", "ai"]` as its value. A filename such as `3dprinter.js` uses the ID `3dprinter`, while its Discord prefix is `!3d`.

Skills are enabled and disabled **only by manually editing this list and restarting**. `!skills` displays status; it cannot change settings. You can also rerun `npm run setup` with the bot stopped to update token, owners, and channels. Setup preserves your skill selection.

## Credentials in .env

Keep one `NAME=value` entry per line. Setup writes `DISCORD_TOKEN` for you. A token or key can be written without quotes; do not put it inside JSON brackets or paste it into Discord. Keep existing credential lines when adding another one. Lines starting with `#` are comments in `.env`, unlike JSON.

## When Is a Restart Required?

| Change                                                             | Restart?                                      |
| ------------------------------------------------------------------ | --------------------------------------------- |
| Owners, channels, permissions, or enabled skills in `config.json`  | Yes                                           |
| Discord token in `.env`                                            | Yes                                           |
| Printer entries/groups, printer LAN codes, or AI profiles/API keys | No; loaded by the next relevant skill command |
| Skill source code or bot program files                             | Yes                                           |

For terminal startup, press **Ctrl+C**, then run `npm start` from the project folder. For the Linux service, use `sudo systemctl restart skillsbot`; do not also run `npm start`. [Service instructions](DEPLOYMENT.md) cover stopping and starting it.

Private files and `.backups/` are ignored by Git. Preserve them during updates and avoid including them in public support requests.
