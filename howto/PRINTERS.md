# 3D Printer Skill: Setup and Use

Complete [main-bot installation](../docs/GETTING_STARTED.md) first. Confirm `!info` works. This guide adds printer monitoring; it does not change the bot's owners, token, or Discord channel settings.

The module ID is **`3dprinter`**, its commands start with **`!3d`**, and its device settings live in **`printers.json`**. The skill is disabled by default.

## 1. Prepare Your Printer

The computer running SkillsBot must be able to reach the printer or its printer-management server. Wi-Fi is sufficient when both devices can communicate on the local network. A guest network may block this access.

For **Bambu Lab**, have these ready:

| Detail                | Where to find it                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Printer IP address    | Printer network settings or your router's connected-device list.                                |
| LAN access code       | Printer network/LAN settings; follow the manual for your model because menu names vary.         |
| Printer serial number | Printer/device information; normally discovered automatically, but keep it ready as a fallback. |

Allow local LAN access according to the printer's settings. This integration uses local telemetry rather than a Bambu cloud login. LAN-only mode disconnects cloud access, and firmware authorization varies; see [Bambu's explanation](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/) and [Compatibility](../docs/COMPATIBILITY.md). Do not assume developer mode is required for monitoring.

For another brand, identify its available API: **Moonraker**, **OctoPrint**, or **PrusaLink**. A brand name alone does not establish compatibility. Start with [Compatibility](../docs/COMPATIBILITY.md), then use section 6 below.

## 2. Add Your First Bambu Printer

Open a terminal in the project folder. You can leave the bot running for this step and use a second terminal. Run:

```bash
npm run printer:add -- --id bambu1
```

`bambu1` is the printer's **command ID**. Choose a different ID for each printer, using up to 48 lowercase letters/numbers, hyphens, or underscores, starting with a letter or number. It must not be `all` or an existing group ID. Its friendly display name can contain spaces, but Discord commands use the command ID.

The wizard currently asks questions in Swedish:

| Prompt                                                | What you enter                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `Skrivarens IP-adress`                                | This printer's IP address.                                                |
| `Serienummer` (only if discovery fails)               | This printer's serial number.                                             |
| `Skrivarnamn` (only if the name cannot be discovered) | A friendly name, for example `Office Printer`.                            |
| `LAN-kod (dold inmatning)`                            | The LAN access code. Input is hidden; paste it and press Enter.           |
| `Grupp`                                               | Press Enter for a standalone printer, or enter a group ID such as `farm`. |

The wizard checks the connection and fetches model, firmware, and reported AMS units. Wait for **`Sparad:`**. It saves the device in `printers.json`, the LAN code in `.env`, and a private backup under `.backups/`. Buffers and exhaust fans are not stored.

If connection checks fail, correct the reported problem and rerun the wizard. Do not type LAN codes in Discord. Re-adding the same serial updates its existing entry; normally omit `--id` when updating so its ID is retained.

For another printer, repeat with an unused ID:

```bash
npm run printer:add -- --id bambu2
```

## 3. Activate the Printer Skill Manually

Stop the bot with **Ctrl+C**, or `sudo systemctl stop skillsbot` if using the Linux service. Open private `config.json` in a text editor. Change the existing `skills` list:

| Desired setup                               | Value                           |
| ------------------------------------------- | ------------------------------- |
| Printers only                               | `"skills": ["3dprinter"]`       |
| Printers and an already configured AI skill | `"skills": ["3dprinter", "ai"]` |

Keep your actual owners, channels, permissions, and any other skill names. See [file editing](../docs/CONFIGURATION.md#open-and-save-files) for editor instructions.

Save and run:

```bash
npm run check
```

Expect `Selected skills: 3dprinter.` (or your combined list). Start again with `npm start`, or `sudo systemctl start skillsbot` for the service. In Discord, `!info` should now list `3dprinter` as loaded.

## 4. Check Status and AMS in Discord

Send these in an allowed server text channel:

```text
!3d printers
!3d status bambu1
!3d ams bambu1
!3d help
```

`!3d printers` lists command IDs and display names. Use the listed ID if you allowed the wizard to choose one automatically.

Status shows progress and estimated time remaining during a print, an idle message when no job is running, or the reported error/status when available. A failed connection means status could not be fetched; it is different from an idle printer. Error/HMS codes may be shown without a text description.

AMS output lists each reported unit and slot, filament type, a basic color square/name, and estimated remaining percentage when supplied by the printer. Multiple AMS units need no separate manual configuration. `Okänt` means an estimate is unavailable; colored squares approximate the base color, and spool percentages are estimates.

Read-only printer commands are available to everyone in permitted channels by default. To restrict status to selected users, add a `3d.status` user-ID list under `permissions` in `config.json` and restart. Owners always retain access.

## 5. Put Printers in Groups

The wizard can add a printer to the group you enter. To group existing printers manually, open `printers.json`. Keep the `printers` section intact and replace the existing empty `groups` value `{}` with:

```json
{
  "farm": ["bambu1", "bambu2"]
}
```

These IDs must already exist under `printers`. A printer can belong to several groups or none. Group IDs follow the same lowercase naming rules and must not duplicate printer IDs. A group cannot be empty; delete its entry when removing its last member.

Save, run `npm run check`, then test:

```text
!3d printers farm
!3d status farm
!3d ams farm
!3d status all
!3d ams all
```

No restart is needed for device or group changes while the printer skill is enabled. `all` queries all enabled printers, including those outside groups.

## 6. Add a Voron or Another API Printer

These are **complete first-printer examples** for `printers.json`. Replace the example hostnames with your actual IP/hostname and use the port configured on your server. Example `.invalid` addresses do not connect to hardware.

If you already have printers, **add an entry inside the existing `printers` object** instead of replacing the entire file. Preserve existing groups and credentials. [Connection templates](../printers.example.json) show additional patterns.

### Voron with Moonraker/Klipper

```json
{
  "printers": {
    "voron1": {
      "brand": "voron",
      "protocol": "moonraker",
      "url": "http://voron-printer.invalid:7125"
    }
  },
  "groups": {}
}
```

If your Moonraker server requires an API key, add `"apiKeyEnv": "VORON1_API_KEY"` to the entry and a `VORON1_API_KEY=YOUR_KEY` line to `.env`. Keep all existing credential lines.

### Prusa with PrusaLink

```json
{
  "printers": {
    "prusa1": {
      "brand": "prusa",
      "protocol": "prusalink",
      "url": "http://prusa-printer.invalid",
      "apiKeyEnv": "PRUSA1_API_KEY"
    }
  },
  "groups": {}
}
```

Get the key from your PrusaLink configuration and add `PRUSA1_API_KEY=YOUR_KEY` to `.env`. This adapter requires PrusaLink's v1 status API.

### A Printer Connected Through OctoPrint

```json
{
  "printers": {
    "printer1": {
      "brand": "creality",
      "protocol": "octoprint",
      "url": "http://octoprint-server.invalid",
      "apiKeyEnv": "OCTOPRINT_API_KEY"
    }
  },
  "groups": {}
}
```

Set `brand` to your printer's catalog ID from [Compatibility](../docs/COMPATIBILITY.md). Get the API key from your OctoPrint configuration and add `OCTOPRINT_API_KEY=YOUR_KEY` to `.env`.

For all examples, run `npm run check`, activate `3dprinter` as in section 3 if needed, and test `!3d status` with the new ID. These APIs report printer status; AMS information is specific to Bambu telemetry.

## 7. Disable or Remove a Printer

To keep a printer's configuration but exclude it from queries, add `"enabled": false` to its entry in `printers.json`. This disables the device without disabling the whole skill.

To remove it completely:

1. [Back up your private configuration](../docs/CONFIGURATION.md).
2. Find its command ID with `!3d printers` or by looking under `printers` in `printers.json`.
3. Delete that printer's complete entry, including any `ams` list. Fix the surrounding commas.
4. Remove its ID from every group. Delete groups that become empty.
5. Run `npm run check`, then `!3d printers` to confirm removal.

Optionally remove its unused LAN-code/API-key line from `.env`. Use the deleted entry's `passwordEnv` or `apiKeyEnv` value to identify the line; keep it if another printer still uses it. Preserve the Discord token and other credentials. There is no Discord command for adding/removing printers.

To disable the **whole skill**, remove `"3dprinter"` from `config.json` → `skills` and restart. Stored printers remain available for later activation.

## Troubleshooting and Metadata Refresh

| Problem                              | What to check                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| No `!3d` response                    | `3dprinter` must be in `config.json` → `skills`; restart after editing.                                  |
| Unknown printer/group                | Use the exact ID from `!3d printers`, rather than its friendly display name.                             |
| Discovery cannot find a name/serial  | Enter them manually when prompted; discovery and status access use different network traffic.            |
| Connection refused or timeout        | Check the IP/port, API availability, printer power, and communication from the bot computer.             |
| Authentication error                 | Check the LAN code/API key and the corresponding `.env` variable.                                        |
| TLS/certificate error on Bambu       | Check the printer serial and bundled CA file; do not disable certificate verification to hide the error. |
| No AMS data or unknown percentage    | The printer/firmware may not report it; this is not a guaranteed spool measurement.                      |
| Invalid JSON or missing group member | Check commas and use only printer IDs that exist.                                                        |

To refresh automatically fetched Bambu names, firmware, and AMS metadata, run `npm run printer:refresh` in the project terminal. Metadata and credential changes apply on the next command; they do not activate a disabled skill.
