import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const EDITOR_RE = /^\s*(vi|vim|nvim)(?=$|\s)([\s\S]*)$/;
const VIM_COMPATIBLE_EDITORS = ["vim", "nvim", "vi"] as const;

function runVim(ctx: ExtensionContext, cwd: string, vimCommand: string): Promise<number | null> {
  return ctx.ui.custom<number | null>((tui, _theme, _keybindings, done) => {
    tui.stop();
    process.stdout.write("\x1b[2J\x1b[H");

    const shell = process.env.SHELL || "/bin/sh";
    const result = spawnSync(shell, ["-c", vimCommand], {
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

function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", command], {
    stdio: "ignore",
    env: process.env,
  });
  return result.status === 0;
}

function getConfiguredVimCommand(): string | undefined {
  const editor = (process.env.VISUAL || process.env.EDITOR)?.trim();
  if (!editor) return undefined;

  const match = EDITOR_RE.exec(editor);
  if (!match || !commandExists(match[1])) return undefined;
  return editor;
}

function getVimCommand(): string {
  return getConfiguredVimCommand() ?? VIM_COMPATIBLE_EDITORS.find(commandExists) ?? "vim";
}

function toVimCommand(command: string): string | undefined {
  const match = EDITOR_RE.exec(command);
  if (!match) return undefined;

  const editor = commandExists(match[1]) ? match[1] : getVimCommand();
  return `${editor}${match[2] ?? ""}`;
}

export default function vimExtension(pi: ExtensionAPI) {
  pi.on("user_bash", async (event, ctx) => {
    const vimCommand = toVimCommand(event.command);
    if (!vimCommand) return;

    if (!ctx.hasUI) {
      return {
        result: {
          output: "(vim requires interactive mode)",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    const exitCode = await runVim(ctx, event.cwd, vimCommand);

    return {
      result: {
        output:
          exitCode === 0
            ? "(vim completed successfully)"
            : `(vim exited with code ${exitCode ?? 1})`,
        exitCode: exitCode ?? 1,
        cancelled: false,
        truncated: false,
      },
    };
  });

  pi.registerCommand("ext:vim", {
    description: "Open vim-compatible editor",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("vim requires interactive mode", "error");
        return;
      }
      const vimCommand = getVimCommand();
      const trimmedArgs = args.trim();
      await runVim(ctx, ctx.cwd, trimmedArgs ? `${vimCommand} ${trimmedArgs}` : vimCommand);
    },
  });
}
