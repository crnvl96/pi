import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_args, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      return {
        dispose: footerData.onBranchChange(() => tui.requestRender()),
        invalidate() {},
        render(width: number): string[] {
          let input = 0;
          let output = 0;
          let cost = 0;
          let cacheRead = 0;
          let cacheWrite = 0;

          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              input += m.usage.input;
              output += m.usage.output;
              cost += m.usage.cost.total;
              cacheRead += m.usage.cacheRead;
              cacheWrite += m.usage.cacheWrite;
            }
          }

          const fmtNumber = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
          const left = theme.fg(
            "dim",
            `↑${fmtNumber(input)} ↓${fmtNumber(output)} · ↑${fmtNumber(cacheWrite)} ↓${fmtNumber(cacheRead)} · $${cost.toFixed(2)}`,
          );

          let provider = "";
          let id = "";
          let thinkingLevel = "";

          if (ctx.model) {
            provider = ctx.model.provider;
            id = ctx.model.id;
            thinkingLevel = pi.getThinkingLevel();
          }

          const branch = footerData.getGitBranch() || "no-branch";
          const right = theme.fg("dim", `${provider} · ${id} · ${thinkingLevel} · ${branch}`);

          const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });
  });
}
