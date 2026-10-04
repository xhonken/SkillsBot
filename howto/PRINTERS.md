# Add and Remove Printers

The printer skill is disabled by default. Stop the bot, add `"3dprinter"` to the existing `skills` list in private `config.json`, and restart. For example, `"skills": ["3dprinter"]` enables printers only. Preserve any other skill names you want enabled. Adding a printer does not enable the skill.

Open a terminal in the project folder as the bot user:

```bash
cd SkillsBot
```

## Add a Bambu Printer

```bash
npm run printer:add
```

1. Enter the printer's IP address and LAN access code. The code is hidden while typing.
2. Name and serial are normally discovered automatically. If discovery fails, enter them manually. Model, firmware and AMS units are fetched from the printer.
3. Enter an optional group, or press Enter for a standalone printer. When updating an existing printer, Enter preserves its groups.

The connection is checked before saving. Adding the same serial again updates the existing printer. The wizard prints its command ID, for example `bambu1`.

Other printer brands use manual configuration; see [connection examples](../printers.example.json).

## Manage Groups

Edit `groups` in `printers.json` locally, using existing printer IDs, for example `"farm": ["bambu1", "bambu2"]`. Delete the group's entry to remove it; its printers remain configured. Run `npm run check` after editing. Discord commands only display information.

## Remove a Printer

There is currently no `printer:remove` command. Find the printer's **ID** using `!3d printers` in Discord. Back up the files before editing:

```bash
printer_backup_dir=".backups/manual-$(date +%Y%m%d-%H%M%S)"
mkdir -p -m 700 "$printer_backup_dir"
cp -p printers.json .env "$printer_backup_dir/"
nano printers.json
```

1. Remove the printer's complete entry from `printers`, including its `ams` list. Keep JSON commas valid.
2. Remove its ID from **every** group under `groups`. For example, removing `bambu1` changes `["bambu1", "bambu2"]` to `["bambu2"]`. Delete a group entirely if it becomes empty.
3. Save with **Ctrl+O**, Enter; exit with **Ctrl+X**.
4. Run `npm run check`. If validation fails, fix the JSON or restore the backup before proceeding.

Optionally remove the deleted printer's LAN-code line from `.env` with `nano .env`. Use its former `passwordEnv` value to identify the line; keep it if another printer references it. Preserve `DISCORD_TOKEN` and other printers' credentials.

## Verify and Refresh

In Discord, run `!3d printers`, then `!3d status bambu1` and `!3d ams bambu1` for a remaining printer. Removed printers should disappear from the list and groups.

Use `!3d help` for all printer commands. Targets can be individual IDs, groups, or `all`, for example `!3d ams all` or `!3d printers farm`.

No bot restart is needed; changes apply on the next printer command. To refresh names, firmware and AMS metadata:

```bash
npm run printer:refresh
```

Enter LAN codes only in the local terminal. Keep credentials and backups private.
