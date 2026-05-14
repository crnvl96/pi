import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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
  pi.registerCommand("res", {
    description: "Copy the latest assistant response into the editor",
    handler: async (_args, ctx) => {
      const latestResponse = getLatestAssistantResponse(ctx);
      if (latestResponse) {
        ctx.ui.setEditorText(latestResponse);
      } else {
        ctx.ui.notify("No assistant response found.", "warning");
      }
    },
  });
}
