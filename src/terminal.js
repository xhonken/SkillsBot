import { createInterface } from "node:readline";
import { Writable } from "node:stream";

export class PromptError extends Error {}

export function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY)
    return Promise.reject(
      new PromptError("Run this guide in an interactive terminal."),
    );
  return new Promise((resolve, reject) => {
    const output = new Writable({
      write(chunk, encoding, callback) {
        if (!hidden) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const rl = createInterface({
      input: process.stdin,
      output,
      terminal: true,
    });
    if (hidden) process.stdout.write(question);
    rl.once("SIGINT", () => {
      reject(new PromptError("Cancelled. No settings were saved."));
      rl.close();
      process.stdout.write("\n");
    });
    rl.question(hidden ? "" : question, (answer) => {
      resolve(answer.trim());
      rl.close();
      if (hidden) process.stdout.write("\n");
    });
    rl.once("close", () => reject(new PromptError("Input ended.")));
  });
}
