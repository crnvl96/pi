/**
 * Custom Footer Extension - demonstrates ctx.ui.setFooter()
 *
 * footerData exposes data not otherwise accessible:
 * - getGitBranch(): current git branch
 * - getExtensionStatuses(): texts from ctx.ui.setStatus()
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const ansi = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
} as const;

const color = (code: string, text: string) => `${code}${text}${ansi.reset}`;
const gray = (text: string) => color(ansi.gray, text);
const joinStatusParts = (parts: Array<string | undefined>) =>
  parts.filter((part): part is string => !!part).join(gray(" · "));

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
          const sessionLabel =
            ctx.sessionManager.getSessionName() || ctx.sessionManager.getSessionId();
          let cwd = ctx.cwd;
          const home = process.env.HOME;
          if (home && cwd === home) {
            cwd = "~/";
          } else if (home && cwd.startsWith(`${home}/`)) {
            cwd = `~/${cwd.slice(home.length + 1)}`;
          }
          const cwdStr = branch ? `${cwd} (${branch})` : cwd;
          const thinkingLevel = pi.getThinkingLevel();
          const modelStr = ctx.model ? gray(`${ctx.model.provider}/${ctx.model.id}`) : undefined;
          const contextUsage = ctx.getContextUsage();
          const contextColor =
            contextUsage?.percent === undefined || contextUsage.percent === null
              ? undefined
              : contextUsage.percent <= 50
                ? ansi.green
                : contextUsage.percent < 70
                  ? ansi.yellow
                  : ansi.red;
          const contextStr =
            contextUsage?.percent === undefined || contextUsage.percent === null || !contextColor
              ? undefined
              : color(
                  contextColor,
                  `${contextUsage.percent.toFixed(1)}%/${fmt(contextUsage.contextWindow)}`,
                );
          const leftContent = joinStatusParts([
            sessionLabel ? gray(sessionLabel) : undefined,
            modelStr,
            cwdStr ? gray(cwdStr) : undefined,
            thinkingLevel ? theme.getThinkingBorderColor(thinkingLevel)(thinkingLevel) : undefined,
            contextStr,
          ]);

          return [truncateToWidth(leftContent, width)];
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
