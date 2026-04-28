import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const LAZYGIT_COMMAND = "/home/linuxbrew/.linuxbrew/bin/lazygit";
const VIM_COMMAND = "/usr/bin/vimx";

const LAZYGIT_RE = /^\s*(lazygit|lzg|git)\s*$/;
const VIM_RE = /^\s*(vi|vim|nvim)(?=$|\s)([\s\S]*)$/;

type ShellCommand = {
  name: "lazygit" | "vim";
  command: string;
};

function runShellCommand(
  ctx: ExtensionContext,
  cwd: string,
  command: string,
): Promise<number | null> {
  return ctx.ui.custom<number | null>((tui, _theme, _keybindings, done) => {
    tui.stop();
    process.stdout.write("\x1b[2J\x1b[H");

    const shell = process.env.SHELL || "/bin/sh";
    const result = spawnSync(shell, ["-c", command], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    tui.start();
    tui.requestRender(true);
    done(result.status ?? 1);

    return { render: () => [], invalidate: () => {} };
  });
}

function toShellCommand(command: string): ShellCommand | undefined {
  if (LAZYGIT_RE.test(command)) {
    return { name: "lazygit", command: LAZYGIT_COMMAND };
  }

  const vimMatch = VIM_RE.exec(command);
  if (vimMatch) {
    return { name: "vim", command: `${VIM_COMMAND}${vimMatch[2] ?? ""}` };
  }

  return undefined;
}

export default function shellExtension(pi: ExtensionAPI) {
  pi.on("user_bash", async (event, ctx) => {
    const shellCommand = toShellCommand(event.command);
    if (!shellCommand) return;

    if (!ctx.hasUI) {
      return {
        result: {
          output: `(${shellCommand.name} requires interactive mode)`,
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    const exitCode = await runShellCommand(ctx, event.cwd, shellCommand.command);

    return {
      result: {
        output:
          exitCode === 0
            ? `(${shellCommand.name} completed successfully)`
            : `(${shellCommand.name} exited with code ${exitCode ?? 1})`,
        exitCode: exitCode ?? 1,
        cancelled: false,
        truncated: false,
      },
    };
  });

  pi.registerCommand("ext:lazygit", {
    description: "Open lazygit",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("lazygit requires interactive mode", "error");
        return;
      }
      await runShellCommand(ctx, ctx.cwd, LAZYGIT_COMMAND);
    },
  });

  pi.registerCommand("ext:vim", {
    description: "Open vim-compatible editor",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("vim requires interactive mode", "error");
        return;
      }
      const trimmedArgs = args.trim();
      await runShellCommand(
        ctx,
        ctx.cwd,
        trimmedArgs ? `${VIM_COMMAND} ${trimmedArgs}` : VIM_COMMAND,
      );
    },
  });
}
