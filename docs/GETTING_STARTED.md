# SkillsBot: Complete Step-by-Step Installation

This guide takes you from downloading SkillsBot to a working Discord bot, your first printer, and an optional AI connection. Follow the numbered steps in order. Skip a skill section if you do not need it.

| Part                      | What it configures                                                    | Steps |
| ------------------------- | --------------------------------------------------------------------- | ----- |
| Main bot                  | Installation, Discord token, owners, and allowed channels.            | 1–5   |
| Optional 3D printer skill | Printer connection, manual skill activation, and status/AMS commands. | 6–9   |
| Optional AI skill         | Model/API settings, manual skill activation, and questions.           | 10–12 |
| Optional Linux service    | Running the bot after logout/reboot.                                  | 13    |

Every skill starts **disabled**. You activate each one manually in `config.json`; configuring a printer or AI model alone does not enable a skill.

A **terminal command** begins with `npm`, `node`, `git`, or another program name. Run it on the computer that will run the bot. A **Discord command** begins with `!`; send it in your Discord server text channel. Copy one command at a time, without the surrounding Markdown backticks.

## Part 1 — Install the Main Bot

### Step 1: Install the Required Software

You need a computer that can stay on, internet access, and a Discord server where you can add bots.

**Windows:** open the [Node.js download page](https://nodejs.org/en/download), select **24 LTS**, and download/run the Windows installer. Keep npm selected during installation. Open **Command Prompt** afterward.

**macOS:** download/run the macOS installer for **Node.js 24 LTS** from the same page. Open **Terminal** afterward.

**Debian, Ubuntu, or Raspberry Pi OS:** run these in a terminal as your regular account:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates nano
```

Install Node.js with nvm, following the method shown on the [official Node.js download page](https://nodejs.org/en/download):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 24
nvm use 24
```

These commands are for Linux/Pi Bash, not Windows Command Prompt. A supported 64-bit Raspberry Pi OS installation uses ARM64. `sudo` may ask for your computer account password.

On every system, check:

```bash
node --version
npm --version
```

**Checkpoint:** both commands print version numbers; Node begins with `v24.`. The project's minimum is 20.19, but use 24 LTS for a new installation.

### Step 2: Download SkillsBot and Install Its Dependencies

For a first installation, you can download a ZIP without using Git:

1. Open [github.com/xhonken/SkillsBot](https://github.com/xhonken/SkillsBot).
2. Click the green **Code** button, then **Download ZIP**.
3. Extract the ZIP. On Windows, right-click and choose **Extract All**. On macOS, double-click it. Move the extracted folder to a permanent folder you can write to.
4. Open the extracted folder, normally `SkillsBot-main`. Confirm it contains `package.json`, `src`, and `docs`.
5. Open a terminal **in that folder**. On Windows, click File Explorer's address bar, type `cmd`, and press Enter. On Linux, use your file manager's **Open in Terminal** option. On macOS, type `cd ` in Terminal, drag the folder into the window, then press Enter.
6. Run:

```bash
npm ci
```

Wait for it to finish. This installs the bot's dependencies. Use this same **project folder** for every npm command below.

Alternatively, if Git is installed, use a clone instead of the ZIP. Install [Git](https://git-scm.com/downloads) if needed, then:

```bash
git clone https://github.com/xhonken/SkillsBot.git
cd SkillsBot
npm ci
```

Linux/Pi users installed Git in step 1. A Git clone supports `git pull` updates; the ZIP does not. Choose one download method, not both.

**Checkpoint:** `npm ci` finishes successfully. If it cannot find `package.json`, your terminal is in the wrong folder.

### Step 3: Create the Discord Bot and Collect Its Token and IDs

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Choose **New Application**, name it `SkillsBot`, and create it.
2. Open **Bot**, use **Reset Token** to generate a bot token, and copy it. Keep it private for the next step.
3. On **Bot**, enable **Message Content Intent** under Privileged Gateway Intents, then save.
4. On **Installation**, enable **Guild Install** and choose **Discord Provided Link**. In guild install settings, select the **bot** scope and permissions **View Channels**, **Send Messages**, and **Read Message History**.
5. Open the installation link, choose **Add to server**, select your server, and approve. The bot appears in the member list, initially offline.
6. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click your own profile and choose **Copy User ID**. This will make you a bot owner.
7. Right-click the server text channel you want the bot to use and choose **Copy Channel ID**.

User/channel IDs are full numeric IDs, normally 17–20 digits. A server ID or account tag cannot replace your user ID. For several owners, collect each person's user ID.

Discord's [installation instructions](https://docs.discord.com/developers/quick-start/getting-started) and [ID instructions](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID) cover these screens.

**Checkpoint:** you have the bot token, your user ID, and your channel ID. The bot has been invited to the server and can read/send messages in that channel.

### Step 4: Enter the Token, Owner IDs, and Channel

Return to the project terminal and run:

```bash
npm run setup
```

Follow these prompts:

1. **`Discord bot token:`** — paste the bot token from step 3, without surrounding quotes, and press Enter. No characters or asterisks appear because input is hidden.
2. **`Owner user IDs, comma separated:`** — paste your user ID and press Enter. For two owners, enter their actual IDs separated by a comma.
3. **`Allowed channel IDs …:`** — paste the channel ID and press Enter. Alternatively, enter `all` to allow every server channel the bot can access.

Setup stores the token in private **`.env`** as `DISCORD_TOKEN=...`. It stores owners and channels in private **`config.json`**. It also creates empty printer configuration and an AI template; no skills are enabled.

If you need to correct these entries, stop the bot and run `npm run setup` again. Enter preserves an existing value; typing `all` clears channel restrictions. Setup preserves manually chosen skills.

**Checkpoint:** the terminal prints **`Saved private settings.`** Never paste tokens or LAN codes into Discord.

### Step 5: Check and Start the Main Bot

Run:

```bash
npm run check
npm start
```

Run these separately; resolve a configuration error before starting. Expect `Configuration valid`, `Selected skills: (none).`, then `Loaded skills: (none)` and `Logged in as …`.

In the allowed Discord server text channel, send these separately:

```text
!help
!info
!skills
```

**Checkpoint:** `!info` shows the version and **`Loaded skills (none)`**. `!skills` lists available skills as **`disabled`**. Your main bot works. `!info` and `!skills` are owner-only; commands in direct messages are ignored.

Keep the terminal open while running. **Ctrl+C** stops the bot. Run only one copy for a token. Continue with the printer section, skip to AI, or leave the main bot without skills.

## Part 2 — Add the Optional 3D Printer Skill

Steps 6–9 use a **Bambu Lab printer** as the first-printer example. For Voron/Moonraker, PrusaLink, or OctoPrint, use the manual connection examples in the [printer guide](../howto/PRINTERS.md#6-add-a-voron-or-another-api-printer), then follow steps 8–9 with that printer's ID.

### Step 6: Find the Printer's Connection Details

On your printer, find:

| Information     | Where to look                                                                              |
| --------------- | ------------------------------------------------------------------------------------------ |
| IP address      | Printer network settings or your router's connected-device list.                           |
| LAN access code | Printer network/LAN settings; consult the model's manual if the menu differs.              |
| Serial number   | Device/printer information. The wizard normally finds it, but keep it ready as a fallback. |

The computer running the bot must reach the printer on the local network. Wi-Fi is sufficient. Guest Wi-Fi or network isolation can prevent communication. Allow local access according to your model's settings; LAN-only mode can change cloud availability, and firmware behavior varies. See [Compatibility](COMPATIBILITY.md) before changing access modes.

You do not need to enter separate AMS serial numbers: reported AMS units are fetched during setup.

**Checkpoint:** you have this printer's IP, LAN code, and serial available. These are different from the Discord bot token and owner ID.

### Step 7: Run the Printer Wizard

Stop the terminal bot with **Ctrl+C** so you can use the same terminal. Run:

```bash
npm run printer:add -- --id bambu1
```

`bambu1` is your chosen **command ID**, used in Discord. Follow the English prompts:

1. **`Printer IP address:`** — enter the printer's IP, then Enter.
2. If asked for **`Serial number …:`**, enter its serial number. This prompt only appears when discovery cannot supply it.
3. If asked for **`Printer name:`**, enter a friendly display name such as `Office Printer`. Otherwise the discovered name is used.
4. **`LAN access code (hidden input):`** — paste the printer's LAN access code, then Enter. Input stays hidden.
5. **`Group …:`** — press Enter for a standalone first printer, or enter `farm` to create/join that group.

Wait while the wizard checks the connection and fetches model, firmware, and AMS information. It writes the printer to **`printers.json`** and its LAN code to **`.env`**, preserving the Discord token.

**Checkpoint:** you see **`Saved: … (bambu1), … AMS unit(s).`** If it fails, check the details and network, then rerun. An idle printer is fine; it does not need an active print for setup.

### Step 8: Enable the Printer Skill in config.json

Adding the printer did not enable the skill. Open **`config.json`** in a plain text editor. On Windows, use Notepad. On Linux/Pi:

```bash
nano config.json
```

Find the existing `"skills": []` entry and change it to:

```text
"skills": ["3dprinter"]
```

Change only that list; keep your actual owners, channels, and permissions. If other skills are already enabled, keep their names and add `"3dprinter"`. Do not create a second `skills` entry.

Save the same filename, not `config.json.txt`. In nano, press **Ctrl+O**, Enter, then **Ctrl+X**. Run:

```bash
npm run check
npm start
```

**Checkpoint:** the selected/loaded skills include **`3dprinter`**. The module ID is `3dprinter`, but its Discord command prefix is `!3d`.

### Step 9: Test the Printer in Discord

Send these **one at a time**, waiting at least five seconds between printer listing/status/AMS requests:

```text
!info
!3d printers
!3d status bambu1
!3d ams bambu1
```

**Checkpoint:** the printer list includes `bambu1`. Status shows progress/time remaining if printing, **`No active print job`** if idle, or the reported problem. AMS output lists each reported unit and slot; **`Unknown`** means a value was not supplied. Remaining filament is an estimate, and color squares approximate base colors.

For a second Bambu printer, stop the terminal bot and run `npm run printer:add -- --id bambu2`. Enter `farm` as its group if desired. You can also put existing IDs into the `groups` section of `printers.json`, as explained in [the printer guide](../howto/PRINTERS.md#5-put-printers-in-groups).

Restart with `npm start` if you stopped it. `!3d status farm` queries a configured group; `!3d status all` queries all enabled printers, including standalone ones. Printer entries and groups reload on the next printer command when the skill is enabled.

## Part 3 — Add the Optional AI Skill

Skip this part if you do not want AI. The main bot does not need an AI key, and the printer skill works independently of AI.

### Step 10: Configure an AI Connection in ai.json

Stop the terminal bot with **Ctrl+C**. Choose one route:

- **Local AI:** obtain the reachable API base address and exact model ID from your existing AI server. SkillsBot connects to that server; it does not install or host the model.
- **OpenAI:** obtain your API key and a text model ID available to your API account.
- **Claude:** obtain a workspace-scoped Claude Console API key and a Messages API model ID available to your account.

Open private **`ai.json`**. The existing template already contains `local`, `openai`, and `claude` profiles. Edit only the profile you want:

| Choice | Top-level `active` | Inside the matching profile                                                                                                                                          | Credential in `.env`                     |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Local  | `"local"`          | Set `baseUrl` to the actual server API base and `model` to its exact model ID. Keep `provider` as `"openai-compatible"`; keep `apiKeyEnv: null` if no key is needed. | None for an unauthenticated server.      |
| OpenAI | `"openai"`         | Replace `REPLACE_WITH_OPENAI_MODEL_ID` with the actual model ID. Keep provider/key-variable names unchanged.                                                         | Add `OPENAI_API_KEY=YOUR_ACTUAL_KEY`.    |
| Claude | `"claude"`         | Replace `REPLACE_WITH_CLAUDE_MODEL_ID` with the actual model ID. Keep provider/key-variable names unchanged.                                                         | Add `ANTHROPIC_API_KEY=YOUR_ACTUAL_KEY`. |

Replace top-level `"active": null` with the profile you chose, for example `"active": "local"`. `active` contains the **profile name**, not the model ID. JSON `null` is unquoted. A `baseUrl` ending in `/v1` must not include `/chat/completions`; the bot adds that suffix for compatible servers.

If the AI runs on a different machine, `localhost` would point to the bot computer, so use the AI server's address. If it requires a key, follow the local-authentication example in [the AI guide](../howto/AI.md#option-a-local-gpt-oss-or-another-compatible-server).

For hosted AI, open **`.env`** and add the corresponding key line from the table. Replace `YOUR_ACTUAL_KEY` with your key and keep `DISCORD_TOKEN` and all printer credentials. For details on creating provider keys and complete profile examples, see [OpenAI](../howto/AI.md#option-b-openai) or [Claude](../howto/AI.md#option-c-claude). API usage may cost money.

**Checkpoint:** `active` matches a configured profile, its actual model ID is set, and any required key is present in `.env`. Selecting this profile does not yet enable the AI skill.

### Step 11: Enable the AI Skill in config.json

Open **`config.json`** again and edit the existing `skills` list:

| Desired setup   | Entry                           |
| --------------- | ------------------------------- |
| AI only         | `"skills": ["ai"]`              |
| Printers and AI | `"skills": ["3dprinter", "ai"]` |

Preserve any other skill names you want enabled, along with owners/channels/permissions. Save, then run:

```bash
npm run check
npm start
```

Resolve missing-key or configuration messages before asking a question. This check reads local settings; it does not prove the AI API is reachable.

**Checkpoint:** the selected/loaded skills include `ai`, and the check shows your chosen profile/provider/model.

### Step 12: Ask Your First AI Question in Discord

As a configured owner, send these separately:

```text
!info
!ai info
!ai q Say hello in one short sentence.
```

**Checkpoint:** `!ai info` shows the expected provider/model. `!ai q` first sends **`Please wait; the answer will arrive shortly.`**, then an answer in a code block. This question is the real API connection test; large models can take longer.

AI questions are owner-only by default. Each request is independent: the skill does not read channel history, printer data, or files, and has no automatic web access. The default AI instruction requests English unless the user asks for another language.

To change models later, edit `ai.json`; changes apply on the next command. To disable a skill, remove its name from `config.json` → `skills` and restart. Discord cannot enable or disable skills.

## Part 4 — Optional Automatic Startup on Linux/Pi

### Step 13: Run the Main Bot as a Background Service

Do this only after the terminal bot works. Stop it with **Ctrl+C**. From the project folder as the same regular user, run each line separately:

```bash
npm run check
npm run service:generate
sudo install -m 644 .local/skillsbot.service /etc/systemd/system/skillsbot.service
sudo systemctl daemon-reload
sudo systemctl enable --now skillsbot
systemctl status skillsbot --no-pager
```

The generator uses your actual folder, username, and Node executable. Expect **`active (running)`** and a reply to `!info`. You can now close the terminal; the bot starts after reboot. On Windows/macOS, keep using terminal startup.

For later `config.json` edits, save, run `npm run check`, and use `sudo systemctl restart skillsbot`. Do not also run `npm start` while the service is active. The [service guide](DEPLOYMENT.md) covers logs, updates, and removal.

## Troubleshooting

| Problem                                   | What to check                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node`/`npm` not found                    | Finish step 1 and reopen the terminal.                                                                                                                |
| npm cannot find `package.json`            | Open the terminal in the extracted/cloned project folder.                                                                                             |
| Token/login error                         | Stop the bot, reset its token in the Developer Portal, rerun setup with the new token, and start again.                                               |
| Disallowed gateway intent                 | Enable Message Content Intent on the Bot page and save.                                                                                               |
| Bot online but silent                     | Use the allowed server text channel; check channel ID, Message Content Intent, and read/send permissions.                                             |
| `!info` does not answer but `!help` works | Put your full user ID in `owners` and restart.                                                                                                        |
| No `!3d`/`!ai` response                   | Add its module ID to `config.json` → `skills` manually and restart.                                                                                   |
| Printer connection error                  | Check IP, LAN code/API key, local reachability, and the [printer troubleshooting section](../howto/PRINTERS.md#troubleshooting-and-metadata-refresh). |
| Unknown printer ID                        | Use the ID listed by `!3d printers`, not its display name.                                                                                            |
| AI missing model/key or cannot connect    | Check `active`, model ID, credentials, and the [AI troubleshooting section](../howto/AI.md#troubleshooting-and-optional-settings).                    |
| Invalid JSON                              | Check double quotes, balanced brackets/braces, and commas. Save as the original filename, then rerun `npm run check`.                                 |

Use [Configuration Basics](CONFIGURATION.md) for backups, editing help, owners, channels, and restart rules. Keep private files and real credentials out of support messages.
