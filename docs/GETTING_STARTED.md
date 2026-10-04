# Getting Started

You need a Discord account, a server where you can add apps, and a computer that can stay on while the bot runs. Each installation uses its own Discord application and token.

## 1. Install Node.js and Get the Code

Install [Node.js 24 LTS](https://nodejs.org/en/download), including npm. On a Raspberry Pi, use a compatible Node build; 64-bit Raspberry Pi OS normally uses ARM64. Open a terminal and check:

```bash
node --version
npm --version
```

Install [Git](https://git-scm.com/downloads), then:

```bash
git clone https://github.com/xhonken/SkillsBot.git
cd SkillsBot
npm ci
```

Alternatively, choose **Code → Download ZIP** on GitHub, extract it, and open a terminal in the extracted folder containing `package.json`. Run `npm ci` there. On Windows, Command Prompt can run these commands.

## 2. Prepare Discord

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. On **Bot**, generate a bot token and keep it for terminal setup below. Enable **Message Content Intent** and save.
3. On **Installation**, enable **Guild Install**. Configure the bot scope and permissions: **View Channels**, **Send Messages**, and **Read Message History**.
4. Open the application's installation link and add it to your server. Allow the bot to read and reply in your chosen text channel.
5. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click your own profile and choose **Copy User ID**. Copy your text channel ID similarly if you want to restrict the bot to it.

An owner ID is your full numeric **user ID**, not a short account tag or server ID. Multiple owners are allowed.

Official references: [application creation and installation](https://docs.discord.com/developers/quick-start/getting-started), [message-content intent](https://docs.discord.com/developers/events/gateway#message-content-intent), and [Discord IDs](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).

## 3. Run Setup

In the project folder:

```bash
npm run setup
```

- Paste the **bot token**. The terminal deliberately displays no token or asterisks.
- Paste **owner user IDs**, separated by commas.
- Enter allowed **channel IDs**, or `all` for all server channels the bot can access. On a first installation, Enter also means all.

Setup stores credentials locally and creates empty printer configuration. Every skill is disabled on a fresh installation. Setup preserves existing skill selections when run again; it sends nothing to Discord.

To create only missing files without prompts, run `npm run setup -- --init`. This never overwrites existing files. Add owners and token before starting. Examples document settings and contain no working credentials.

## 4. Start and Verify

```bash
npm run check
npm start
```

After `Logged in as …` appears, type in your server channel:

```text
!help
!info
```

`!info` is owner-only. Commands do not work in DMs. Keep the terminal open and computer awake; **Ctrl+C** stops the bot. Do not run two copies with the same bot token.

## 5. Enable the Skills You Want

Stop the bot with **Ctrl+C**. Open `config.json` in a text editor and find `"skills": []`. Replace only that list as needed:

| Skills to enable | Value in `config.json`          |
| ---------------- | ------------------------------- |
| None (default)   | `"skills": []`                  |
| 3D printers      | `"skills": ["3dprinter"]`       |
| AI               | `"skills": ["ai"]`              |
| Both             | `"skills": ["3dprinter", "ai"]` |

Save the file, run `npm run check`, and start the bot again with `npm start`. Check `!info` or `!skills` in Discord. Skills can only be enabled or disabled by manually editing this list and restarting; remove a name to disable it. The main bot works with an empty list.

Next, [add printers](../howto/PRINTERS.md), [configure AI](../howto/AI.md), or [enable Linux startup](DEPLOYMENT.md). Device and model configuration does not automatically enable a skill.

## Troubleshooting

| Symptom                             | What to check                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `node` or `npm` not found           | Install Node.js and reopen the terminal.                                                 |
| Setup needs an interactive terminal | Open Command Prompt, Terminal, or an SSH terminal; run setup directly.                   |
| Invalid owner/channel ID            | Copy the full 17–20 digit ID with Developer Mode enabled.                                |
| Token/login failure                 | Reset the application's token, stop the bot, and rerun setup.                            |
| Disallowed gateway intent           | Enable Message Content Intent for this application.                                      |
| Online but no reply                 | Use a server text channel; check channel restrictions and read/send/history permissions. |
| No `!info` reply                    | Check your user ID in `owners`.                                                          |
| No `!3d` or `!ai` commands          | Add the skill's module ID to `config.json` → `skills`, then restart the bot.             |
| No printers or selected AI          | Add your devices or choose an AI profile.                                                |

Keep credentials and backups private when requesting help. Share error messages with tokens and device information removed.
