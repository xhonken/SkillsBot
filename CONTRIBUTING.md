# Contributing

Use Node.js 24 LTS and ES modules. Follow existing two-space indentation, camelCase functions, and Prettier formatting. Keep documentation, built-in bot replies, terminal prompts, help text, and default AI instructions in English. Preserve user-provided text and printer-reported diagnostics as supplied. Skill filenames are lowercase module IDs with unique command prefixes. Read [Writing skills](docs/SKILLS.md) before adding one.

Prepare a checkout without personal configuration:

```bash
npm ci
npm run setup -- --init
npm test
npm run check
npm run format:check
```

Tests use Node's built-in runner in `tests/*.test.mjs`. Add useful regression cases for permissions, secret handling, configuration writes, and protocol parsing. Tests use synthetic credentials and local simulated servers; Discord or hardware acceptance is separate.

Run `npm run format` before committing. Keep commits focused with short imperative subjects. Pull requests should explain resulting behavior, validation, and compatibility limits. Include redacted examples for output changes.

Never commit private configuration, tokens, real serials, LAN codes, API keys, or backups. Inspect `git diff --cached` before pushing. Use reserved test hosts such as `printer.invalid` and synthetic Discord IDs.
