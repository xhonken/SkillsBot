# Install and Configure the Main Bot

Follow this guide first. At the end, SkillsBot will be connected to Discord with **no skills enabled**. Printers and AI are optional additions covered in separate guides.

## Before You Start

You need:

- A Windows, macOS, Linux, or Raspberry Pi computer that stays on while the bot runs.
- Internet access for Discord and installation downloads.
- A Discord account and permission to add a bot to a server.

There are three places where you will work:

| Place                       | What you do there                                    |
| --------------------------- | ---------------------------------------------------- |
| Computer terminal           | Run commands beginning with `npm`, `node`, or `git`. |
| Local text editor           | Edit files such as `config.json`.                    |
| Discord server text channel | Send commands beginning with `!`, such as `!info`.   |

Copy commands one line at a time and press Enter after each. Do not paste the surrounding Markdown backticks. A **terminal** means Command Prompt on Windows or Terminal on macOS/Linux; an SSH terminal on your bot computer works too.

## 1. Install Node.js and Git

Node.js runs the bot. npm, included with Node.js, installs its dependencies. Git downloads and updates the project.

**Windows/macOS:** install [Node.js 24 LTS](https://nodejs.org/en/download) using the installer for your operating system. Install [Git](https://git-scm.com/downloads) too, then open a new terminal. On Windows, use **Command Prompt** for this guide.

**Debian, Ubuntu, or Raspberry Pi OS:** open a terminal and install the supporting tools:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates nano
```

Install Node.js using the **Linux → nvm → npm** instructions on the [official Node.js download page](https://nodejs.org/en/download). Select version **24 LTS**, run the displayed commands, and reopen the terminal. Use a supported operating system; 64-bit Raspberry Pi OS uses ARM64.

Check the installation:

```bash
node --version
npm --version
git --version
```

All three should print version numbers. Node should start with `v24.` for this guide. The project's minimum is Node.js 20.19, but new installations should use 24 LTS.

## 2. Download SkillsBot

In the terminal, choose a folder you can write to, such as your home folder, and run:

```bash
git clone https://github.com/xhonken/SkillsBot.git
cd SkillsBot
npm ci
```

Wait for `npm ci` to finish. The `SkillsBot` folder is now your **project folder**. Run all later npm commands from this folder; it contains `package.json`.

If you downloaded a ZIP instead, extract it, open a terminal in the extracted folder containing `package.json`, and run `npm ci`. Git-based update commands apply only to a Git clone.

## 3. Create and Invite Your Discord Bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Choose **New Application**, name it `SkillsBot`, and create it.
2. Open **Bot**. Generate a token using **Reset Token**, then copy it for setup. This token belongs to the bot; it is different from your user ID.
3. On **Bot**, under **Privileged Gateway Intents**, enable **Message Content Intent** and save. SkillsBot needs it to read `!` commands.
4. Open **Installation** and enable **Guild Install**. Select **Discord Provided Link**. In guild install settings, add the **bot** scope and permissions **View Channels**, **Send Messages**, and **Read Message History**.
5. Open the installation link, choose **Add to server**, select your server, and approve. You should see the bot in the server member list, initially offline.

Discord's [installation guide](https://docs.discord.com/developers/quick-start/getting-started) explains these settings. Channel permissions must also allow the bot to read and reply in the channel you choose.

## 4. Copy Your Owner and Channel IDs

In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click your profile and choose **Copy User ID**. This is a full numeric ID, normally 17–20 digits.

Optionally right-click your intended text channel and choose **Copy Channel ID**. A server ID does not replace a user ID or channel ID. See [Discord's ID instructions](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).

Every owner uses their own user ID. Owners can run `!info` and `!skills`; they also bypass configured command access lists.

## 5. Configure the Main Bot

In the project terminal:

```bash
npm run setup
```

Answer the three prompts:

| Prompt              | What to enter                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Discord bot token   | Paste the token from step 3, then press Enter. Input is hidden: seeing no characters is normal.                     |
| Owner user IDs      | Paste your user ID. For several owners, separate their IDs with commas.                                             |
| Allowed channel IDs | Paste your channel ID. Use `all` to allow all server channels the bot can access. First-time Enter also allows all. |

Setup creates four private files: `config.json`, `.env`, `printers.json`, and `ai.json`. It leaves `skills` empty and asks for no printer or AI credentials. Never share the token or these private files.

Run:

```bash
npm run check
```

Expect `Configuration valid` and `Selected skills: (none).` This checks local settings; it does not test a Discord login.

## 6. Start and Test the Main Bot

```bash
npm start
```

Wait for `Loaded skills: (none)` and `Logged in as …`. In the allowed Discord **server text channel**, send these separately:

```text
!help
!info
!skills
```

`!info` should show the bot version and no loaded skills. `!skills` should list available modules as disabled. The main bot is now working.

Keep the terminal open and the computer awake. **Ctrl+C** stops the bot. After restarting the computer, open a terminal in the project folder and run `npm start` again. Commands in direct messages are ignored. Run only one bot process per token.

For automatic startup on a Raspberry Pi or Linux server, follow [Linux Automatic Startup](DEPLOYMENT.md) after this test succeeds.

## 7. Choose Optional Skills

Continue with whichever guide you need:

- [3D printer skill](../howto/PRINTERS.md): add printers, groups, and Bambu AMS monitoring.
- [AI skill](../howto/AI.md): connect a local AI server, OpenAI, or Claude.

**Every skill must be activated manually in `config.json` and the bot restarted.** Adding a printer or selecting a model does not activate its skill. Each guide explains this step independently; use both if you want both skills.

For owners, channels, backups, file editing, and restart rules, see [Configuration Basics](CONFIGURATION.md).

## Troubleshooting

| Problem                                         | What to do                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `node`, `npm`, or `git` not found               | Finish step 1 and reopen the terminal.                                                                     |
| npm cannot find `package.json`                  | Change to the project folder before running npm commands.                                                  |
| Setup requires an interactive terminal          | Run setup directly in Command Prompt, Terminal, or SSH, without redirecting its input.                     |
| Invalid owner/channel ID                        | Copy the full ID using Developer Mode; remove names, tags, and brackets.                                   |
| Token/login failure                             | Reset the token in the Developer Portal. Stop the bot, rerun `npm run setup`, and start it again.          |
| Disallowed gateway intent                       | Enable Message Content Intent on the application's Bot page and save.                                      |
| Bot online but silent                           | Use a server text channel. Check channel IDs, Message Content Intent, and the bot's read/send permissions. |
| `!help` works but `!info` or `!skills` does not | Check that your user ID is in `owners`, then restart after correcting it.                                  |
| `!3d` or `!ai` does not respond                 | Follow the relevant skill guide to configure and activate it, then restart.                                |

When asking for help, share the error text with credentials and personal device information removed.
