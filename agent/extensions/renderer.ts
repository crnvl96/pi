import type {
  BashToolDetails,
  EditToolDetails,
  ExtensionAPI,
  ReadToolDetails,
} from "@mariozechner/pi-coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

const READ_PREVIEW_LINE_LIMIT = 15;
const BASH_PREVIEW_LINE_LIMIT = 20;
const DIFF_PREVIEW_LINE_LIMIT = 30;
const WRITE_PREVIEW_LINE_LIMIT = 30;
const COMMAND_PREVIEW_WIDTH = 80;

type ToolContent = {
  type: string;
  text?: string;
};

type DiffStats = {
  additions: number;
  removals: number;
};

function renderText(text: string): Text {
  return new Text(text, 0, 0);
}

function truncateCommand(command: string): string {
  if (command.length <= COMMAND_PREVIEW_WIDTH) return command;
  return `${command.slice(0, COMMAND_PREVIEW_WIDTH - 3)}...`;
}

function getFirstTextContent(content: readonly ToolContent[]): string | undefined {
  const first = content[0];
  return first?.type === "text" ? first.text : undefined;
}

function getErrorLine(text: string | undefined): string | undefined {
  if (!text?.startsWith("Error")) return undefined;
  return text.split("\n")[0];
}

function countNonEmptyLines(text: string): number {
  return text.split("\n").filter((line) => line.trim()).length;
}

function isDiffAddition(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++");
}

function isDiffRemoval(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("---");
}

function countDiffStats(diffLines: string[]): DiffStats {
  let additions = 0;
  let removals = 0;

  for (const line of diffLines) {
    if (isDiffAddition(line)) additions++;
    if (isDiffRemoval(line)) removals++;
  }

  return { additions, removals };
}

function registerReadRenderer(pi: ExtensionAPI, cwd: string): void {
  const readTool = createReadToolDefinition(cwd);

  pi.registerTool({
    ...readTool,

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("read "));
      text += theme.fg("accent", args.path);
      if (args.offset || args.limit) {
        const parts: string[] = [];
        if (args.offset) parts.push(`offset=${args.offset}`);
        if (args.limit) parts.push(`limit=${args.limit}`);
        text += theme.fg("dim", ` (${parts.join(", ")})`);
      }
      return renderText(text);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return renderText(theme.fg("warning", "Reading..."));

      const details = result.details as ReadToolDetails | undefined;
      const content = result.content[0];

      if (content?.type === "image") {
        return renderText(theme.fg("success", "Image loaded"));
      }

      const textContent = getFirstTextContent(result.content);
      if (textContent === undefined) {
        return renderText(theme.fg("error", "No content"));
      }

      const lines = textContent.split("\n");
      const lineCount = lines.length;
      let text = theme.fg("success", `${lineCount} lines`);

      if (details?.truncation?.truncated) {
        text += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
      }

      if (expanded) {
        for (const line of lines.slice(0, READ_PREVIEW_LINE_LIMIT)) {
          text += `\n${theme.fg("dim", line)}`;
        }
        if (lineCount > READ_PREVIEW_LINE_LIMIT) {
          text += `\n${theme.fg("muted", `... ${lineCount - READ_PREVIEW_LINE_LIMIT} more lines`)}`;
        }
      }

      return renderText(text);
    },
  });
}

function registerBashRenderer(pi: ExtensionAPI, cwd: string): void {
  const bashTool = createBashToolDefinition(cwd, {
    spawnHook: ({ command, cwd, env }) => ({
      command: `source ~/.profile\n${command}`,
      cwd,
      env: { ...env },
    }),
  });

  pi.registerTool({
    ...bashTool,

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("$ "));
      text += theme.fg("accent", truncateCommand(args.command));
      if (args.timeout) {
        text += theme.fg("dim", ` (timeout: ${args.timeout}s)`);
      }
      return renderText(text);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return renderText(theme.fg("warning", "Running..."));

      const details = result.details as BashToolDetails | undefined;
      const output = getFirstTextContent(result.content) ?? "";
      const outputLines = output.split("\n");

      const exitMatch = output.match(/exit code: (\d+)/);
      const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;
      const lineCount = countNonEmptyLines(output);

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
        for (const line of outputLines.slice(0, BASH_PREVIEW_LINE_LIMIT)) {
          text += `\n${theme.fg("dim", line)}`;
        }
        if (outputLines.length > BASH_PREVIEW_LINE_LIMIT) {
          text += `\n${theme.fg("muted", "... more output")}`;
        }
      }

      return renderText(text);
    },
  });
}

function registerEditRenderer(pi: ExtensionAPI, cwd: string): void {
  const editTool = createEditToolDefinition(cwd);

  pi.registerTool({
    ...editTool,

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("edit "));
      text += theme.fg("accent", args.path);
      return renderText(text);
    },

    renderResult(result, { isPartial }, theme, _context) {
      if (isPartial) return renderText(theme.fg("warning", "Editing..."));

      const details = result.details as EditToolDetails | undefined;
      const errorLine = getErrorLine(getFirstTextContent(result.content));
      if (errorLine) {
        return renderText(theme.fg("error", errorLine));
      }

      if (!details?.diff) {
        return renderText(theme.fg("success", "Applied"));
      }

      const diffLines = details.diff.split("\n");
      const { additions, removals } = countDiffStats(diffLines);

      let text = theme.fg("success", `+${additions}`);
      text += theme.fg("dim", " / ");
      text += theme.fg("error", `-${removals}`);

      for (const line of diffLines.slice(0, DIFF_PREVIEW_LINE_LIMIT)) {
        if (isDiffAddition(line)) {
          text += `\n${theme.fg("success", line)}`;
        } else if (isDiffRemoval(line)) {
          text += `\n${theme.fg("error", line)}`;
        } else {
          text += `\n${theme.fg("dim", line)}`;
        }
      }
      if (diffLines.length > DIFF_PREVIEW_LINE_LIMIT) {
        text += `\n${theme.fg("muted", `... ${diffLines.length - DIFF_PREVIEW_LINE_LIMIT} more diff lines`)}`;
      }

      return renderText(text);
    },
  });
}

function registerWriteRenderer(pi: ExtensionAPI, cwd: string): void {
  const writeTool = createWriteToolDefinition(cwd);

  pi.registerTool({
    ...writeTool,

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("write "));
      text += theme.fg("accent", args.path);
      const lines = args.content.split("\n");
      text += theme.fg("dim", ` (${lines.length} lines)`);

      for (const line of lines.slice(0, WRITE_PREVIEW_LINE_LIMIT)) {
        text += `\n${theme.fg("dim", line)}`;
      }
      if (lines.length > WRITE_PREVIEW_LINE_LIMIT) {
        text += `\n${theme.fg("muted", `... ${lines.length - WRITE_PREVIEW_LINE_LIMIT} more lines`)}`;
      }

      return renderText(text);
    },

    renderResult(result, { isPartial }, theme, _context) {
      if (isPartial) return renderText(theme.fg("warning", "Writing..."));

      const errorLine = getErrorLine(getFirstTextContent(result.content));
      if (errorLine) {
        return renderText(theme.fg("error", errorLine));
      }

      return renderText(theme.fg("success", "Written"));
    },
  });
}

export default function toolRendererExtension(pi: ExtensionAPI) {
  const cwd = process.cwd();
  registerReadRenderer(pi, cwd);
  registerBashRenderer(pi, cwd);
  registerEditRenderer(pi, cwd);
  registerWriteRenderer(pi, cwd);
}
