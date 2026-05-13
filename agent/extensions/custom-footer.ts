/**
 * Custom Footer Extension - demonstrates ctx.ui.setFooter()
 *
 * footerData exposes data not otherwise accessible:
 * - getGitBranch(): current git branch
 * - getExtensionStatuses(): texts from ctx.ui.setStatus()
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const ansi = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
} as const;

const color = (code: string, text: string) => `${code}${text}${ansi.reset}`;
const gray = (text: string) => color(ansi.gray, text);
const cyan = (text: string) => color(ansi.cyan, text);
const joinStatusParts = (parts: Array<string | undefined>) =>
  parts.filter((part): part is string => !!part).join(gray(" ┃ "));
const lastPathComponent = (cwd: string) => {
  const home = process.env.HOME?.replace(/\/+$/, "");
  const normalizedCwd = cwd.replace(/\/+$/, "");

  if (!normalizedCwd) return cwd;
  if (home && normalizedCwd === home) return "~";

  return normalizedCwd.split("/").pop() || normalizedCwd;
};
const contextThinkingLevel = (percent: number) => {
  if (percent < 10) return "off";
  if (percent < 20) return "minimal";
  if (percent < 30) return "low";
  if (percent < 40) return "medium";
  if (percent < 50) return "high";
  return "xhigh";
};

export default function (pi: ExtensionAPI) {
  let enabled = true;

  function enableFooter(ctx: ExtensionContext) {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // Get git branch (not otherwise accessible)
          const branch = footerData.getGitBranch();
          const fmt = (n: number) => {
            if (n < 1000) return n.toString();
            if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
            if (n < 1000000) return `${Math.round(n / 1000)}k`;
            if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
            return `${Math.round(n / 1000000)}M`;
          };
          const cwd = lastPathComponent(ctx.cwd);
          const cwdStr = branch ? `${cwd} (${branch})` : cwd;
          const thinkingLevel = pi.getThinkingLevel();
          const modelStr = ctx.model ? cyan(`${ctx.model.provider}/${ctx.model.id}`) : undefined;
          const contextUsage = ctx.getContextUsage();
          const contextStr =
            contextUsage?.percent === undefined || contextUsage.percent === null
              ? undefined
              : theme.getThinkingBorderColor(contextThinkingLevel(contextUsage.percent))(
                  `${contextUsage.percent.toFixed(1)}%/${fmt(contextUsage.contextWindow)}`,
                );
          const leftContent = joinStatusParts([
            thinkingLevel ? theme.getThinkingBorderColor(thinkingLevel)(thinkingLevel) : undefined,
            contextStr,
            cwdStr ? cyan(cwdStr) : undefined,
          ]);

          if (!modelStr) return [truncateToWidth(leftContent, width)];

          const modelWidth = visibleWidth(modelStr);
          if (modelWidth >= width) return [truncateToWidth(modelStr, width)];

          const left = truncateToWidth(leftContent, Math.max(0, width - modelWidth - 2));
          const padding = " ".repeat(Math.max(0, width - visibleWidth(left) - modelWidth));

          return [left + padding + modelStr];
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
