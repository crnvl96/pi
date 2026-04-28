import type { EditToolDetails, ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createEditTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

type EditToolOverride = ToolDefinition<ReturnType<typeof createEditTool>["parameters"], EditToolDetails>;

export function createEditToolOverride(cwd: string): EditToolOverride {
  const originalEdit = createEditTool(cwd);
  return {
    name: "edit",
    label: "edit",
    description: originalEdit.description,
    parameters: originalEdit.parameters,
    renderShell: "self",

    async execute(toolCallId, params, signal, onUpdate) {
      return originalEdit.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("edit "));
      text += theme.fg("accent", args.path);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "Editing..."), 0, 0);

      const details = result.details as EditToolDetails | undefined;
      const content = result.content[0];

      if (content?.type === "text" && content.text.startsWith("Error")) {
        return new Text(theme.fg("error", content.text.split("\n")[0]), 0, 0);
      }

      if (!details?.diff) {
        return new Text(theme.fg("success", "Applied"), 0, 0);
      }

      const diffLines = details.diff.split("\n");
      let additions = 0;
      let removals = 0;
      for (const line of diffLines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) removals++;
      }

      let text = theme.fg("success", `+${additions}`);
      text += theme.fg("dim", " / ");
      text += theme.fg("error", `-${removals}`);

      if (expanded) {
        for (const line of diffLines.slice(0, 30)) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            text += `\n${theme.fg("success", line)}`;
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            text += `\n${theme.fg("error", line)}`;
          } else {
            text += `\n${theme.fg("dim", line)}`;
          }
        }
        if (diffLines.length > 30) {
          text += `\n${theme.fg("muted", `... ${diffLines.length - 30} more diff lines`)}`;
        }
      }

      return new Text(text, 0, 0);
    },
  };
}
export default function editToolOverrideModule(pi: ExtensionAPI) {
  pi.registerTool(createEditToolOverride(process.cwd()));
}
