import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const EDITOR_RE = /^\s*(vi|vim|nvim)(?=$|\s)([\s\S]*)$/;

function runNvim(ctx: ExtensionContext, cwd: string, nvimCommand: string): Promise<number | null> {
  return ctx.ui.custom<number | null>((tui, _theme, _keybindings, done) => {
    tui.stop();
    process.stdout.write("\x1b[2J\x1b[H");

    const shell = process.env.SHELL || "/bin/sh";
    const result = spawnSync(shell, ["-c", nvimCommand], {
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

function toNvimCommand(command: string): string | undefined {
  const match = EDITOR_RE.exec(command);
  if (!match) return undefined;
  return `nvim${match[2] ?? ""}`;
}

export default function viExtension(pi: ExtensionAPI) {
  pi.on("user_bash", async (event, ctx) => {
    const nvimCommand = toNvimCommand(event.command);
    if (!nvimCommand) return;

    if (!ctx.hasUI) {
      return {
        result: {
          output: "(nvim requires interactive mode)",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    const exitCode = await runNvim(ctx, event.cwd, nvimCommand);

    return {
      result: {
        output:
          exitCode === 0
            ? "(nvim completed successfully)"
            : `(nvim exited with code ${exitCode ?? 1})`,
        exitCode: exitCode ?? 1,
        cancelled: false,
        truncated: false,
      },
    };
  });

  pi.registerShortcut("alt+e", {
    description: "Open nvim",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;
      await runNvim(ctx, ctx.cwd, "nvim");
    },
  });
}
