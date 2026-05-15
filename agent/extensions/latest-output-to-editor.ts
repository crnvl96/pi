import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type TextBlock = { type: "text"; text: string };
type ThinkingBlock = { type: "thinking"; thinking: string };
type ToolCallBlock = { type: "toolCall"; name: string; arguments?: unknown };
type ImageBlock = { type: "image"; mimeType?: string; mediaType?: string };
type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock | ImageBlock | { type: string };

type MessageLike = {
  role: string;
  content?: string | ContentBlock[];
};

type EntryLike = {
  type: string;
  message?: MessageLike;
};

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function contentToText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (block.type === "text") return (block as TextBlock).text;
      if (block.type === "thinking") return (block as ThinkingBlock).thinking;
      if (block.type === "toolCall") {
        const toolCall = block as ToolCallBlock;
        const args = stringify(toolCall.arguments);
        return args ? `[tool call: ${toolCall.name}]\n${args}` : `[tool call: ${toolCall.name}]`;
      }
      if (block.type === "image") {
        const image = block as ImageBlock;
        return `[image${image.mimeType || image.mediaType ? `: ${image.mimeType ?? image.mediaType}` : ""}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function isOutputMessage(message: MessageLike): boolean {
  return message.role === "assistant" || message.role === "toolResult";
}

function latestOutputFromSession(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch() as EntryLike[];

  for (let i = entries.length - 1; i >= 0; i--) {
    const message = entries[i]?.message;
    if (!message || !isOutputMessage(message)) continue;

    const text = contentToText(message.content);
    if (text) return text;
  }

  return "";
}

function dispatchCtrlG() {
  setImmediate(() => {
    process.stdin.emit("data", "\x07");
  });
}

export default function latestOutputToEditor(pi: ExtensionAPI) {
  let latestOutput = "";

  pi.on("session_start", async (_event, ctx) => {
    latestOutput = latestOutputFromSession(ctx);
  });

  pi.on("message_end", async (event) => {
    const message = event.message as MessageLike;
    if (!isOutputMessage(message)) return;

    const text = contentToText(message.content);
    if (text) latestOutput = text;
  });

  async function fillEditor(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    if (!latestOutput) {
      ctx.ui.notify("No assistant/tool output found yet", "warning");
      return;
    }

    ctx.ui.setEditorText(latestOutput);
    dispatchCtrlG();
  }

  pi.registerCommand("latest-to-editor", {
    description: "Put latest assistant/tool output into the editor buffer",
    handler: async (_args, ctx) => fillEditor(ctx),
  });

  pi.registerShortcut("ctrl+shift+g", {
    description: "Put latest assistant/tool output into the editor buffer",
    handler: fillEditor,
  });
}
