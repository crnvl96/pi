import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_INTERACTIVE_COMMANDS = ["vim", "nvim", "vi", "lazygit", "lzg", "nv"];

function isInteractiveCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();

  for (const cmd of DEFAULT_INTERACTIVE_COMMANDS) {
    const cmdLower = cmd.toLowerCase();

    if (
      trimmed === cmdLower ||
      trimmed.startsWith(`${cmdLower} `) ||
      trimmed.startsWith(`${cmdLower}\t`)
    )
      return true;
  }

  return false;
}

export default function (pi: ExtensionAPI) {
  pi.on("user_bash", async (event, ctx) => {
    let command = event.command;

    if (!isInteractiveCommand(command)) return;

    if (command === "lzg") command = "lazygit";
    if (command === "nv") command = "nvim";

    if (!ctx.hasUI)
      return {
        result: {
          output: "(interactive commands require TUI)",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };

    const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
      tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      const shell = process.env.SHELL || "/bin/sh";
      const result = spawnSync(shell, ["-c", command], {
        stdio: "inherit",
        env: process.env,
      });
      tui.start();
      tui.requestRender(true);
      done(result.status);
      return { render: () => [], invalidate: () => {} };
    });

    const output =
      exitCode === 0
        ? "(interactive command completed successfully)"
        : `(interactive command exited with code ${exitCode})`;

    return {
      result: {
        output,
        exitCode: exitCode ?? 1,
        cancelled: false,
        truncated: false,
      },
    };
  });
}
