# Writing Skills

A skill is a trusted local JavaScript ES module in `src/skills/`. Its filename, exported `name`, and configured identifier must match, such as `hello.js` and `hello`. Dependencies must be installed locally before activation. Skills run in the bot process with its filesystem and network access.

The module exports an object with `register(client, context)`. Registration may be asynchronous and must return a cleanup function, or the object must provide `unregister(client)`. Cleanup must release listeners, timers, connections and other resources owned by the skill. The manager rejects modules without this lifecycle contract and removes listeners added during failed registration.

## Command namespaces

Declare a lowercase `namespace`, such as `3d`, `ai`, or `music`. It defaults to the skill's name and may contain letters, numbers, hyphens and underscores, up to 48 characters. The namespace is independent of the module ID: `3dprinter.js` exports `name: "3dprinter", namespace: "3d"` and receives `!3d status` commands. The main bot rejects duplicate active namespaces and reserves `help`, `info`, `skills`, and `skill`.

Every declared command must begin with the skill's exact prefix. Permission keys must use that namespace too, such as `3d.status` or `ai.status`. The manager scopes `messageCreate` listeners added during registration to matching prefixes and leaves namespace help to the core. Register command listeners during `register`; use `parseSkillCommand` in the handler to read the subcommand and arguments. Module code remains trusted and shares the bot's process and access.

```js
import { acceptsMessage, hasPermission } from "../permissions.js";
import { parseSkillCommand } from "../commands.js";
import { reply } from "../messages.js";

export default {
  name: "hello",
  namespace: "hello",
  commands: [
    {
      command: "!hello greet",
      description: "Say hello.",
      permission: "hello.greet",
    },
  ],
  register(client, { config, namespace }) {
    let enabled = true;
    const onMessage = async (message) => {
      if (!enabled || !acceptsMessage(message, config)) return;
      const parsed = parseSkillCommand(message.content, namespace);
      if (parsed?.command !== "greet" || parsed.args.length) return;
      try {
        if (!hasPermission(message.author.id, "hello.greet", config)) {
          await reply(
            message,
            "You do not have permission to use this command.",
          );
          return;
        }
        await reply(message, "Hello!");
      } catch {
        console.error("Hello skill could not send a reply.");
      }
    };
    client.on("messageCreate", onMessage);
    return () => {
      enabled = false;
      client.off("messageCreate", onMessage);
    };
  },
};
```

Keep registration side effects inside `register`, rather than module initialization. On registration failure, the skill must clean up any non-listener resources it allocated. Check command permissions with `hasPermission(userId, key, config)` when needed. Shared helpers enforce channel restrictions and suppress Discord mentions.

## Command help

The main bot owns `!help`, `!info`, `!skills`, and `!skill`; skills must not register their own handlers for these commands. Add a `commands` array to the exported object so the main bot can include the loaded skill in `!help`. Each entry requires a one-line `command` (starting with `!`, at most 160 characters, without backticks or mentions) and a one-line `description` (at most 350 characters). Invalid metadata is rejected before registration.

Optional `permission: "hello.greet"` identifies the configuration permission key used by the handler; `ownerOnly: true` marks an owner-only command. These fields annotate help and do not enforce access themselves: the handler must check the same permission or ownership rule. Unknown permission keys are owner-only by default; configure `"hello.greet": []` under `permissions` to allow everyone, or provide allowed Discord IDs. Printer read-only commands and help are public by default.

The core automatically handles `!<namespace>`, `!<namespace> help`, and `!help <namespace>` for active skills, checking both `permissions.help` and any `<namespace>.help` restriction. Do not implement a second help handler. Skills without `commands` remain loadable and show a missing-help message. Only loaded skills contribute help, and the list updates immediately after activation or removal. Never include credentials or private configuration in help metadata.

An owner activates this module with `!skill add hello` and disables it with `!skill remove hello`. The selection is written to `config.json`; `!info` reflects the active registry. Modules are available without being loaded automatically. Disabling all modules preserves the main bot commands. Restart after changing module source because Node caches imports.

## Reply formatting

Use the shared `reply` helper for Discord responses. It wraps plain text in a labelled code block and preserves responses that already contain code blocks. For structured output, import `codeBox`, `fields`, or `table` from `../messages.js`:

```js
await reply(message, codeBox("Hello", fields([["Status", "Ready"]])));
```

`table` accepts column objects such as `{ label: "Name", maxWidth: 24 }` and arrays of row values. Fields and tables wrap long values rather than truncate them. `codeBox` sanitizes backticks, mentions, and control characters inside its body; `reply` splits long messages with balanced code fences and disables Discord mentions. Check access in the handler before building the response.
