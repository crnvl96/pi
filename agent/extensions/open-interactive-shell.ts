import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function getInteractiveCommand(command: string): string | undefined {
  if (command === "i") {
    return process.env.SHELL || "/bin/sh";
  }

  if (command.startsWith("i ") || command.startsWith("i\t")) {
    return command.slice(2).trim();
  }

  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.on("user_bash", async (event, ctx) => {
    const command = getInteractiveCommand(event.command);

    if (command === undefined) {
      return;
    }

    if (!command) {
      return {
        result: {
          output: "Usage: !i [command]",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    if (!ctx.hasUI) {
      return {
        result: {
          output: "(interactive commands require TUI)",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
      tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");

      const shell = process.env.SHELL || "/bin/sh";
      const result =
        command === shell
          ? spawnSync(shell, { stdio: "inherit", env: process.env })
          : spawnSync(shell, ["-c", command], { stdio: "inherit", env: process.env });

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
