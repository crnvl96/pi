import type {
  BashToolDetails,
  EditToolDetails,
  ExtensionAPI,
  ReadToolDetails,
} from "@mariozechner/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const originalBash = createBashTool(cwd);

  pi.registerTool({
    name: "bash",
    label: "bash",
    description: originalBash.description,
    parameters: originalBash.parameters,

    async execute(toolCallId, params, signal, onUpdate) {
      return originalBash.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("$ "));
      const cmd = args.command.length > 80 ? `${args.command.slice(0, 77)}...` : args.command;
      text += theme.fg("accent", cmd);
      if (args.timeout) {
        text += theme.fg("dim", ` (timeout: ${args.timeout}s)`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);

      const details = result.details as BashToolDetails | undefined;
      const content = result.content[0];
      const output = content?.type === "text" ? content.text : "";

      const exitMatch = output.match(/exit code: (\d+)/);
      const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;
      const lineCount = output.split("\n").filter((l) => l.trim()).length;

      let text = "";
      if (exitCode === 0 || exitCode === null) {
        text += theme.fg("success", "done");
      } else {
        text += theme.fg("error", `exit ${exitCode}`);
      }
      text += theme.fg("dim", ` (${lineCount} lines)`);

      if (details?.truncation?.truncated) {
        text += theme.fg("warning", " [truncated]");
      }

      if (expanded) {
        const lines = output.split("\n").slice(0, 20);
        for (const line of lines) {
          text += `\n${theme.fg("dim", line)}`;
        }
        if (output.split("\n").length > 20) {
          text += `\n${theme.fg("muted", "... more output")}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });
}
