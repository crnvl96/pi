/**
 * Custom Footer Extension - demonstrates ctx.ui.setFooter()
 *
 * footerData exposes data not otherwise accessible:
 * - getGitBranch(): current git branch
 * - getExtensionStatuses(): texts from ctx.ui.setStatus()
 *
 * Token stats come from ctx.sessionManager/ctx.model (already accessible).
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  let enabled = true;

  function enableFooter(ctx: ExtensionContext) {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // Compute tokens from ctx (already accessible to extensions)
          let input = 0,
            output = 0,
            cacheRead = 0,
            cacheWrite = 0,
            cost = 0;
          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              input += m.usage.input;
              output += m.usage.output;
              cacheRead += m.usage.cacheRead;
              cacheWrite += m.usage.cacheWrite;
              cost += m.usage.cost.total;
            }
          }

          // Get git branch (not otherwise accessible)
          const branch = footerData.getGitBranch();
          const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

          const left = theme.fg(
            "dim",
            `↑${fmt(input)} ↓${fmt(output)} R${fmt(cacheRead)} W${fmt(cacheWrite)} $${cost.toFixed(3)}`,
          );
          const branchStr = branch ? ` (${branch})` : "";
          const thinkingLevel = pi.getThinkingLevel();
          const supportsThinking =
            !!ctx.model?.reasoning && ctx.model.thinkingLevelMap?.[thinkingLevel] !== null;
          const modelStr = ctx.model
            ? `${ctx.model.provider}/${ctx.model.id}${supportsThinking ? `:${thinkingLevel}` : ""}`
            : "no-model";
          const right = theme.fg("dim", `${modelStr}${branchStr}`);

          const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    if (enabled) enableFooter(ctx);
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    if (enabled) enableFooter(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    if (enabled) enableFooter(ctx);
  });

  pi.registerCommand("footer", {
    description: "Toggle custom footer",
    handler: async (_args, ctx) => {
      enabled = !enabled;

      if (enabled) {
        enableFooter(ctx);
        ctx.ui.notify("Custom footer enabled", "info");
      } else {
        ctx.ui.setFooter(undefined);
        ctx.ui.notify("Default footer restored", "info");
      }
    },
  });
}
