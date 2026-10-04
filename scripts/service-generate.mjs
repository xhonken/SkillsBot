import { mkdir, readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../src/config.js";

function quoted(value) {
  if (!value || /[\r\n\0]/.test(value))
    throw new Error("Service paths must be nonempty and on one line.");
  return (
    '"' +
    value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("%", "%%") +
    '"'
  );
}

export function renderService(template, { user, root, node }) {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(user) || user === "root")
    throw new Error(
      "Generate the service as the regular user who runs the bot.",
    );
  return template
    .replaceAll("@USER@", user)
    .replaceAll("@WORKDIR@", root.replaceAll("%", "%%"))
    .replaceAll("@ROOT@", quoted(root))
    .replaceAll("@ENV@", join(root, ".env").replaceAll("%", "%%"))
    .replaceAll("@READY@", quoted(join(root, "scripts/check-ready.mjs")))
    .replaceAll("@BOT@", quoted(join(root, "src/bot.js")))
    .replaceAll("@NODE@", quoted(node));
}

async function main() {
  if (process.platform !== "linux")
    throw new Error("Automatic startup with systemd is available on Linux.");
  const template = await readFile(
    new URL("../deploy/skillsbot.service", import.meta.url),
    "utf8",
  );
  const content = renderService(template, {
    user: userInfo().username,
    root: ROOT.replace(/\/$/, ""),
    node: process.execPath,
  });
  const folder = join(ROOT, ".local");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(join(folder, "skillsbot.service"), content, { mode: 0o600 });
  console.log(
    "Generated .local/skillsbot.service for your user, folder and Node binary.\n" +
      "Review that file, then run:\n" +
      "sudo install -m 644 .local/skillsbot.service /etc/systemd/system/skillsbot.service\n" +
      "sudo systemctl daemon-reload\n" +
      "sudo systemctl enable --now skillsbot",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
