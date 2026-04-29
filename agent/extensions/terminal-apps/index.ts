import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const LAZYGIT_COMMAND = "lazygit";
const DEFAULT_EDITOR_COMMAND = "vim";

const LAZYGIT_RE = /^\s*(lazygit|lzg)\s*$/;
const EDITOR_RE = /^\s*(vi|vim|nvim)(?=$|\s)([\s\S]*)$/;

type TerminalAppCommand = {
  name: "lazygit" | "vim";
  command: string;
};

function preferredEditorCommand(args: string): string {
  const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || DEFAULT_EDITOR_COMMAND;
  return args.trim() ? `${editor} ${args.trim()}` : editor;
}

function runTerminalApp(
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

function toTerminalAppCommand(command: string): TerminalAppCommand | undefined {
  if (LAZYGIT_RE.test(command)) {
    return { name: "lazygit", command: LAZYGIT_COMMAND };
  }

  const editorMatch = EDITOR_RE.exec(command);
  if (editorMatch) {
    return { name: "vim", command: `${editorMatch[1]}${editorMatch[2] ?? ""}` };
  }

  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.on("user_bash", async (event, ctx) => {
    const terminalApp = toTerminalAppCommand(event.command);
    if (!terminalApp) return;

    if (!ctx.hasUI) {
      return {
        result: {
          output: `(${terminalApp.name} requires interactive mode)`,
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    const exitCode = await runTerminalApp(ctx, event.cwd, terminalApp.command);

    return {
      result: {
        output:
          exitCode === 0
            ? `(${terminalApp.name} completed successfully)`
            : `(${terminalApp.name} exited with code ${exitCode ?? 1})`,
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
      await runTerminalApp(ctx, ctx.cwd, LAZYGIT_COMMAND);
    },
  });

  pi.registerCommand("ext:vim", {
    description: "Open vim-compatible editor",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("vim requires interactive mode", "error");
        return;
      }
      await runTerminalApp(ctx, ctx.cwd, preferredEditorCommand(args));
    },
  });
}
