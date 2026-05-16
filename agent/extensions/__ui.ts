import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { VERSION } from "@earendil-works/pi-coding-agent";

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

const fmtNumeric = (n: number) => {
  if (n < 1000) return n.toString();
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.round(n / 1000000)}M`;
};

export default function (pi: ExtensionAPI) {
  const applyLabel = (ctx: ExtensionContext) => {
    ctx.ui.setHiddenThinkingLabel("Pondering...");
  };

  function applyHeader(ctx: ExtensionContext) {
    ctx.ui.setHeader((_tui, theme) => {
      return {
        render(_width: number): string[] {
          const subtitle = `${theme.fg("muted", "shitty coding agent")}${theme.fg("dim", ` v${VERSION}`)}`;
          return [subtitle];
        },
        invalidate() {},
      };
    });
  }

  function applyFooter(ctx: ExtensionContext) {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const getCwd = () => {
        const branch = footerData.getGitBranch();
        const cwd = lastPathComponent(ctx.cwd);
        const strCwd = branch ? `${cwd} (${branch})` : cwd;
        if (!strCwd) return undefined;
        return cyan(strCwd);
      };

      const model = ctx.model ? cyan(`${ctx.model.provider}/${ctx.model.id}`) : undefined;

      const getThinkingLevel = () => {
        const thinkingLevel = pi.getThinkingLevel();
        if (!thinkingLevel) return undefined;
        return theme.getThinkingBorderColor(thinkingLevel)(thinkingLevel);
      };

      const getContextUsage = () => {
        const context = ctx.getContextUsage();
        if (context?.percent === undefined || context?.percent === null) return undefined;
        const contextStr = `${context.percent.toFixed(1)}%/${fmtNumeric(context.contextWindow)}`;
        const color = theme.getThinkingBorderColor(contextThinkingLevel(context.percent));
        return color(contextStr);
      };

      const getLeft = () => joinStatusParts([getThinkingLevel(), getContextUsage(), getCwd()]);

      return {
        dispose: footerData.onBranchChange(() => tui.requestRender()),
        invalidate() {},
        render(width: number): string[] {
          const leftContent = getLeft();
          if (!model) return [truncateToWidth(leftContent, width)];

          const modelWidth = visibleWidth(model);
          if (modelWidth >= width) return [truncateToWidth(model, width)];

          const left = truncateToWidth(leftContent, Math.max(0, width - modelWidth - 2));
          const padding = " ".repeat(Math.max(0, width - visibleWidth(left) - modelWidth));
          return [left + padding + model];
        },
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    applyFooter(ctx);
    applyHeader(ctx);
    applyLabel(ctx);
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    applyFooter(ctx);
    applyHeader(ctx);
    applyLabel(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    applyFooter(ctx);
    applyHeader(ctx);
    applyLabel(ctx);
  });
}
