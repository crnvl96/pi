import type { ExtensionAPI, ReadToolDetails, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createReadTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

type ReadToolOverride = ToolDefinition<ReturnType<typeof createReadTool>["parameters"], ReadToolDetails>;

export function createReadToolOverride(cwd: string): ReadToolOverride {
  const originalRead = createReadTool(cwd);
  return {
    name: "read",
    label: "read",
    description: originalRead.description,
    parameters: originalRead.parameters,

    async execute(toolCallId, params, signal, onUpdate) {
      return originalRead.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("read "));
      text += theme.fg("accent", args.path);
      if (args.offset || args.limit) {
        const parts: string[] = [];
        if (args.offset) parts.push(`offset=${args.offset}`);
        if (args.limit) parts.push(`limit=${args.limit}`);
        text += theme.fg("dim", ` (${parts.join(", ")})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "Reading..."), 0, 0);

      const details = result.details as ReadToolDetails | undefined;
      const content = result.content[0];

      if (content?.type === "image") {
        return new Text(theme.fg("success", "Image loaded"), 0, 0);
      }

      if (content?.type !== "text") {
        return new Text(theme.fg("error", "No content"), 0, 0);
      }

      const lineCount = content.text.split("\n").length;
      let text = theme.fg("success", `${lineCount} lines`);

      if (details?.truncation?.truncated) {
        text += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
      }

      if (expanded) {
        const lines = content.text.split("\n").slice(0, 15);
        for (const line of lines) {
          text += `\n${theme.fg("dim", line)}`;
        }
        if (lineCount > 15) {
          text += `\n${theme.fg("muted", `... ${lineCount - 15} more lines`)}`;
        }
      }

      return new Text(text, 0, 0);
    },
  };
}
export default function readToolExtension(pi: ExtensionAPI) {
  pi.registerTool(createReadToolOverride(process.cwd()));
}
