import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type TextBlock = {
  type: "text";
  text: string;
};

type PagerResult = {
  exitCode: number | null;
  error?: string;
};

function isTextBlock(value: unknown): value is TextBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "text" in value &&
    (value as { type: unknown }).type === "text" &&
    typeof (value as { text: unknown }).text === "string"
  );
}

function getAssistantText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(isTextBlock)
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function getLastAssistantResponse(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const text = getAssistantText(entry.message.content);
    if (text.length > 0) {
      return text;
    }
  }

  return undefined;
}

async function openInNeovim(ctx: ExtensionContext, text: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "pi-nvim-"));
  const file = join(dir, "last-agent-response.md");
  writeFileSync(file, text, "utf8");

  try {
    const result = await ctx.ui.custom<PagerResult>((tui, _theme, _kb, done) => {
      tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");

      let pagerResult: PagerResult;
      try {
        const nvim = spawnSync("nvim", [file], {
          stdio: "inherit",
          env: process.env,
          cwd: ctx.cwd,
        });

        pagerResult = {
          exitCode: nvim.status,
          error: nvim.error instanceof Error ? nvim.error.message : undefined,
        };
      } catch (error) {
        pagerResult = {
          exitCode: 1,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        tui.start();
        tui.requestRender(true);
      }

      done(pagerResult);
      return { render: () => [], invalidate: () => {} };
    });

    if (result?.error) {
      ctx.ui.notify(`Failed to run nvim: ${result.error}`, "error");
      return;
    }

    if (result?.exitCode !== 0) {
      ctx.ui.notify(`nvim exited with code ${result?.exitCode ?? 1}`, "warning");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerShortcut("alt+o", {
    description: "Open the last assistant response in neovim",
    handler: async (ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current response to finish before opening neovim.", "warning");
        return;
      }

      const text = getLastAssistantResponse(ctx);
      if (!text) {
        ctx.ui.notify("No assistant response found.", "warning");
        return;
      }

      await openInNeovim(ctx, text);
    },
  });
}
