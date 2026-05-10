/**
 * Built-in Tool Renderer Example - Custom rendering for built-in tools
 *
 * Demonstrates how to override the rendering of built-in tools (read, bash,
 * edit, write) without changing their behavior. Each tool is re-registered
 * with the same name, delegating execution to the original implementation
 * while providing compact custom renderCall/renderResult functions.
 *
 * This is useful for users who prefer more concise tool output, or who want
 * to highlight specific information (e.g., showing only the diff stats for
 * edit, or just the exit code for bash).
 *
 * How it works:
 * - registerTool() with the same name as a built-in replaces it entirely
 * - We create instances of the original tools via createReadTool(), etc.
 *   and delegate execute() to them
 * - renderCall() controls what's shown when the tool is invoked
 * - renderResult() controls what's shown after execution completes
 * - renderShell: "self" lets a tool render its own outer shell instead of
 *   using the default boxed shell from ToolExecutionComponent
 * - The `expanded` flag in renderResult indicates whether the user has
 *   toggled the tool output open (via ctrl+e or clicking)
 *
 * Usage:
 *   pi -e ./built-in-tool-renderer.ts
 */

import type { BashToolDetails, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();

  // --- Bash tool: show command and exit code ---
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
