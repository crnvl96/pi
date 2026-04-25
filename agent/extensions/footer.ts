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
          const branch = footerData.getGitBranch();

          const left = theme.fg(
            "dim",
            `↑${fmtNumber(input)} ↓${fmtNumber(output)} · ↑${fmtNumber(cacheRead)} ↓${fmtNumber(cacheWrite)} · $${cost.toFixed(2)}`,
          );

          const right = theme.fg(
            "dim",
            `${ctx.model?.provider} · ${ctx.model?.id || "no-model"} · ${ctx.model ? pi.getThinkingLevel() : ""} · ${branch ? `${branch}` : ""}`,
          );

          const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });
  });
}
