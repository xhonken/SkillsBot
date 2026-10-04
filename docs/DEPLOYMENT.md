# Linux Automatic Startup

Complete [Getting started](GETTING_STARTED.md) and verify that `npm start` connects to Discord first. These instructions are for Linux with systemd, including Raspberry Pi OS. Run the bot as a regular user. Windows and macOS can use terminal startup.

## Generate and Install

Stop the terminal bot with **Ctrl+C**. In the project folder, as the user who will run SkillsBot:

```bash
npm run check
npm run service:generate
```

This generates `.local/skillsbot.service` for your actual user, project directory, and Node binary. It does not install or start a service. Review the generated file; `deploy/skillsbot.service` is a template and must not be installed directly.

Then:

```bash
sudo install -m 644 .local/skillsbot.service /etc/systemd/system/skillsbot.service
sudo systemctl daemon-reload
sudo systemctl enable --now skillsbot
systemctl status skillsbot --no-pager
```

The bot starts after reboot and restarts after failure. Its startup condition checks owners, token presence, and selected printer configuration. If incomplete, correct the configuration and run `sudo systemctl start skillsbot`.

The service has no elevated capabilities and limits writes to the project folder. It reads private `.env`; generated service files contain paths, not credentials. Use a persistent local folder accessible to the bot user.

## Operate

```bash
journalctl -u skillsbot -n 50 --no-pager
sudo systemctl restart skillsbot
sudo systemctl stop skillsbot
```

Add printers with `npm run printer:add`. Printer and AI settings apply on their next command. Owner/channel/access-rule changes need a restart. Stop the service before `npm run setup`, then start it again.

## Update

Back up `.env`, `config.json`, `printers.json`, and `ai.json` privately. Stop the service and update tracked source:

```bash
sudo systemctl stop skillsbot
git pull --ff-only
npm ci
npm test
npm run check
npm run format:check
sudo systemctl start skillsbot
```

Local configuration remains untracked and is preserved. Do not replace it with examples. If the project or Node path changes, regenerate and reinstall the service. Keep the complete bundled public Bambu CA file.

## Remove Automatic Startup

```bash
sudo systemctl disable --now skillsbot
sudo rm /etc/systemd/system/skillsbot.service
sudo systemctl daemon-reload
```

Your application and local configuration remain in the project folder.
