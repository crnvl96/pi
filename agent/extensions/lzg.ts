import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const LAZYGIT_RE = /^\s*(lazygit|lzg|git)\s*$/;

export default function lzgExtension(pi: ExtensionAPI) {
  pi.on("user_bash", async (event, ctx) => {
    if (!LAZYGIT_RE.test(event.command)) return;

    if (!ctx.hasUI) {
      return {
        result: {
          output: "(lazygit requires interactive mode)",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    const exitCode = await runLazygit(ctx, event.cwd);

    return {
      result: {
        output:
          exitCode === 0
            ? "(lazygit completed successfully)"
            : `(lazygit exited with code ${exitCode ?? 1})`,
        exitCode: exitCode ?? 1,
        cancelled: false,
        truncated: false,
      },
    };
  });

  pi.registerShortcut("alt+g", {
    description: "Open lazygit",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;
      await runLazygit(ctx, ctx.cwd);
    },
  });
}

function runLazygit(ctx: ExtensionContext, cwd: string): Promise<number | null> {
  return ctx.ui.custom<number | null>((tui, _theme, _keybindings, done) => {
    tui.stop();
    process.stdout.write("\x1b[2J\x1b[H");

    const result = spawnSync("lazygit", [], {
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
