import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

function getLatestAssistantResponse(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;

    const message = entry.message;
    if (!("role" in message) || message.role !== "assistant") continue;

    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trimEnd();

    if (text.trim().length > 0) return text;
  }

  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.onTerminalInput((data) => {
      if (!matchesKey(data, "ctrl+shift+g")) return undefined;

      const latestResponse = getLatestAssistantResponse(ctx);
      if (latestResponse) {
        ctx.ui.setEditorText(latestResponse);
      } else {
        ctx.ui.notify(
          "No assistant response found; opening editor with current buffer.",
          "warning",
        );
      }

      // Feed Ctrl+G back into pi so the built-in external-editor action runs.
      return { data: "\x07" };
    });
  });
}
