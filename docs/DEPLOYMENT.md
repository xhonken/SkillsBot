# Linux Automatic Startup and Updates

Use this guide after [main-bot installation](GETTING_STARTED.md) succeeds and you have tested `!info`. It applies to Linux with **systemd**, including Raspberry Pi OS. It controls how the main bot runs; skill configuration remains in its separate guides.

With terminal startup, closing the terminal or logging out can stop your bot. A systemd **service** runs it in the background and starts it after reboot.

## 1. Stop the Terminal Bot

In the terminal where `npm start` is running, press **Ctrl+C**. Run only one process for a token. Open a terminal in the project folder as the regular user who installed SkillsBot; do not run npm setup/generation as root.

## 2. Generate a Service for This Computer

```bash
npm run check
npm run service:generate
```

This creates `.local/skillsbot.service` using your actual username, project folder, and Node binary. Check that the paths in this generated file match your installation. `deploy/skillsbot.service` is a template and must not be installed directly.

Generation only creates a file. Install it and start the background service:

```bash
sudo install -m 644 .local/skillsbot.service /etc/systemd/system/skillsbot.service
sudo systemctl daemon-reload
sudo systemctl enable --now skillsbot
systemctl status skillsbot --no-pager
```

`sudo` may ask for your computer account password. Expect **`active (running)`**. The bot should also answer `!info` in Discord. You may now close the terminal; the service remains running and is enabled for reboot.

The service checks required startup settings and restarts after a process failure. It runs as your regular user, reads private `.env`, and restricts writes to the project folder. Generated service files contain local paths, not credentials; keep the project in a persistent folder accessible to that user.

## 3. Start, Stop, Restart, and Read Logs

These commands work in any terminal on the bot computer:

| Task             | Command                                    |
| ---------------- | ------------------------------------------ |
| Show status      | `systemctl status skillsbot --no-pager`    |
| Show recent logs | `journalctl -u skillsbot -n 50 --no-pager` |
| Stop             | `sudo systemctl stop skillsbot`            |
| Start            | `sudo systemctl start skillsbot`           |
| Restart          | `sudo systemctl restart skillsbot`         |

If logs are inaccessible to your account, use `sudo journalctl -u skillsbot -n 50 --no-pager`. A stopped service will not answer Discord commands. Do not run `npm start` while the service is active.

For changes to owners, channels, permissions, the Discord token, or the enabled `skills` list, save the files, run `npm run check` from the project folder, then restart the service. Stop the service before rerunning `npm run setup`; start it afterward.

Printer entries/groups, printer LAN codes, and AI profiles/API keys reload on their next command while the corresponding skill is enabled. Device/model configuration does not automatically activate a skill.

## 4. Update a Git-Based Installation

[Back up private configuration](CONFIGURATION.md) first. These commands require a Git clone; a ZIP installation needs a fresh source download and careful transfer of your private files instead.

In the project folder:

```bash
sudo systemctl stop skillsbot
git pull --ff-only
npm ci
npm run check
sudo systemctl start skillsbot
systemctl status skillsbot --no-pager
```

Run each line separately. If a command fails, resolve the error before continuing. Local configuration remains untracked and is preserved; do not replace it with templates. `npm run check` does not test the Discord login or remote devices, so verify `!info` and your enabled skills afterward.

If the project folder, bot username, or Node binary path changes, stop the service, regenerate/reinstall it using step 2, then run `sudo systemctl daemon-reload` and start it again. This also applies when changing to a different Node installation.

## Troubleshooting

| Problem                                     | What to do                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `systemctl` is unavailable                  | Use terminal startup on this OS; this guide requires systemd.                                                     |
| Service is inactive or skipped              | Read recent logs. Set at least one owner and a valid Discord token; fix selected printer settings, then start it. |
| Service keeps restarting                    | Read startup errors in the logs, correct the cause, and restart.                                                  |
| Works with `npm start` but not as a service | Confirm generated paths, bot user, folder access, and `.env`; regenerate after changing Node/project paths.       |
| Discord replies appear twice                | Stop the extra terminal process or duplicate service using the same token.                                        |

## Remove Automatic Startup

```bash
sudo systemctl disable --now skillsbot
sudo rm /etc/systemd/system/skillsbot.service
sudo systemctl daemon-reload
```

The bot is now stopped and will not start after reboot. Its project and private configuration remain; you can still use `npm start` for terminal startup.
