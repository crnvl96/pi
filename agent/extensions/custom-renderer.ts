import type {
  BashToolDetails,
  EditToolDetails,
  ExtensionAPI,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  ReadToolDetails,
} from "@mariozechner/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { homedir } from "os";

const MAX_PATH_WIDTH = 80;
const READ_PREVIEW_LINES = 15;
const OUTPUT_PREVIEW_LINES = 20;
const DIFF_PREVIEW_LINES = 30;

function shortenPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function truncateText(text: string, maxWidth = MAX_PATH_WIDTH): string {
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 3)}...`;
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const content = result.content.find((item) => item.type === "text");
  return content?.text ?? "";
}

function nonEmptyLineCount(text: string): number {
  return text.split("\n").filter((line) => line.trim()).length;
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function preview(text: string, maxLines: number, color: (value: string) => string): string {
  const lines = text.split("\n");
  const visible = lines.slice(0, maxLines).map(color).join("\n");
  if (lines.length <= maxLines) return visible;
  return `${visible}\n${color(`... ${lines.length - maxLines} more lines`)}`;
}

function countDiffLines(diff: string): { additions: number; removals: number } {
  let additions = 0;
  let removals = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) removals++;
  }

  return { additions, removals };
}

type BuiltInTools = ReturnType<typeof createBuiltInTools>;
const toolCache = new Map<string, BuiltInTools>();

function createBuiltInTools(cwd: string) {
  return {
    read: createReadTool(cwd),
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    find: createFindTool(cwd),
    grep: createGrepTool(cwd),
    ls: createLsTool(cwd),
  };
}

function getBuiltInTools(cwd: string): BuiltInTools {
  let tools = toolCache.get(cwd);
  if (!tools) {
    tools = createBuiltInTools(cwd);
    toolCache.set(cwd, tools);
  }
  return tools;
}

export default function (pi: ExtensionAPI) {
  const defaults = getBuiltInTools(process.cwd());

  pi.registerTool({
    name: "read",
    label: "read",
    description: defaults.read.description,
    parameters: defaults.read.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).read.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const path = theme.fg("accent", truncateText(shortenPath(args.path || "...")));
      const parts: string[] = [];
      if (args.offset !== undefined) parts.push(`offset ${args.offset}`);
      if (args.limit !== undefined) parts.push(`limit ${args.limit}`);
      const suffix = parts.length > 0 ? theme.fg("dim", ` (${parts.join(", ")})`) : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("read"))} ${path}${suffix}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "reading"), 0, 0);

      const content = result.content[0];
      if (content?.type === "image") return new Text(theme.fg("success", "image loaded"), 0, 0);
      if (content?.type !== "text") return new Text(theme.fg("error", "no content"), 0, 0);

      const details = result.details as ReadToolDetails | undefined;
      const lines = lineCount(content.text);
      let text = theme.fg("success", `${lines} lines`);
      if (details?.truncation?.truncated) {
        text += theme.fg("warning", `, truncated from ${details.truncation.totalLines}`);
      }
      if (expanded && content.text) {
        text += `\n${preview(content.text, READ_PREVIEW_LINES, (line) => theme.fg("toolOutput", line))}`;
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "bash",
    label: "bash",
    description: defaults.bash.description,
    parameters: defaults.bash.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).bash.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const command = theme.fg("accent", truncateText(args.command || "..."));
      const timeout = args.timeout ? theme.fg("dim", ` (${args.timeout}s)`) : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("$"))} ${command}${timeout}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "running"), 0, 0);

      const details = result.details as BashToolDetails | undefined;
      const output = firstText(result);
      const exitMatch = output.match(/exit code: (\d+)/);
      const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;
      const lines = nonEmptyLineCount(output);

      let text = exitCode === null || exitCode === 0 ? theme.fg("success", "done") : theme.fg("error", `exit ${exitCode}`);
      text += theme.fg("dim", ` (${lines} lines)`);
      if (details?.truncation?.truncated) text += theme.fg("warning", " truncated");
      if (expanded && output) {
        text += `\n${preview(output.trim(), OUTPUT_PREVIEW_LINES, (line) => theme.fg("toolOutput", line))}`;
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "edit",
    label: "edit",
    description: defaults.edit.description,
    parameters: defaults.edit.parameters,
    renderShell: "default",

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).edit.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const path = theme.fg("accent", truncateText(shortenPath(args.path || "...")));
      const count = args.edits?.length ? theme.fg("dim", ` (${args.edits.length} edits)`) : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${path}${count}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "editing"), 0, 0);

      const output = firstText(result);
      if (output.toLowerCase().startsWith("error")) {
        return new Text(theme.fg("error", output.split("\n")[0]), 0, 0);
      }

      const details = result.details as EditToolDetails | undefined;
      if (!details?.diff) return new Text(theme.fg("success", "applied"), 0, 0);

      const stats = countDiffLines(details.diff);
      let text = theme.fg("success", "applied");
      text += theme.fg("dim", " (");
      text += theme.fg("toolDiffAdded", `+${stats.additions}`);
      text += theme.fg("dim", " ");
      text += theme.fg("toolDiffRemoved", `-${stats.removals}`);
      text += theme.fg("dim", ")");

      if (expanded) {
        const diffLines = details.diff.split("\n");
        for (const line of diffLines.slice(0, DIFF_PREVIEW_LINES)) {
          if (line.startsWith("+") && !line.startsWith("+++")) text += `\n${theme.fg("success", line)}`;
          else if (line.startsWith("-") && !line.startsWith("---")) text += `\n${theme.fg("error", line)}`;
          else text += `\n${theme.fg("dim", line)}`;
        }
        if (diffLines.length > DIFF_PREVIEW_LINES) {
          text += `\n${theme.fg("muted", `... ${diffLines.length - DIFF_PREVIEW_LINES} more diff lines`)}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "write",
    label: "write",
    description: defaults.write.description,
    parameters: defaults.write.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const path = theme.fg("accent", truncateText(shortenPath(args.path || "...")));
      const lines = args.content ? lineCount(args.content) : 0;
      const suffix = lines > 0 ? theme.fg("dim", ` (${lines} lines)`) : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("write"))} ${path}${suffix}`, 0, 0);
    },

    renderResult(result, { isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "writing"), 0, 0);

      const output = firstText(result);
      if (output.toLowerCase().startsWith("error")) {
        return new Text(theme.fg("error", output.split("\n")[0]), 0, 0);
      }
      return new Text(theme.fg("success", "written"), 0, 0);
    },
  });

  pi.registerTool({
    name: "find",
    label: "find",
    description: defaults.find.description,
    parameters: defaults.find.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const pattern = theme.fg("accent", args.pattern || "...");
      const path = theme.fg("dim", ` in ${shortenPath(args.path || ".")}`);
      const limit = args.limit !== undefined ? theme.fg("dim", ` limit ${args.limit}`) : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("find"))} ${pattern}${path}${limit}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "finding"), 0, 0);

      const details = result.details as FindToolDetails | undefined;
      const output = firstText(result).trim();
      const count = output ? output.split("\n").length : 0;
      let text = theme.fg("success", `${count} files`);
      if (details?.truncation?.truncated || details?.resultLimitReached) text += theme.fg("warning", " truncated");
      if (expanded && output) text += `\n${preview(output, OUTPUT_PREVIEW_LINES, (line) => theme.fg("toolOutput", line))}`;
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "grep",
    label: "grep",
    description: defaults.grep.description,
    parameters: defaults.grep.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const pattern = theme.fg("accent", `/${args.pattern || ""}/`);
      const path = theme.fg("dim", ` in ${shortenPath(args.path || ".")}`);
      const glob = args.glob ? theme.fg("dim", ` ${args.glob}`) : "";
      const limit = args.limit !== undefined ? theme.fg("dim", ` limit ${args.limit}`) : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("grep"))} ${pattern}${path}${glob}${limit}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "searching"), 0, 0);

      const details = result.details as GrepToolDetails | undefined;
      const output = firstText(result).trim();
      const count = output ? output.split("\n").length : 0;
      let text = theme.fg("success", `${count} matches`);
      if (details?.truncation?.truncated || details?.matchLimitReached) text += theme.fg("warning", " truncated");
      if (expanded && output) text += `\n${preview(output, OUTPUT_PREVIEW_LINES, (line) => theme.fg("toolOutput", line))}`;
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "ls",
    label: "ls",
    description: defaults.ls.description,
    parameters: defaults.ls.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const path = theme.fg("accent", shortenPath(args.path || "."));
      const limit = args.limit !== undefined ? theme.fg("dim", ` limit ${args.limit}`) : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("ls"))} ${path}${limit}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "listing"), 0, 0);

      const details = result.details as LsToolDetails | undefined;
      const output = firstText(result).trim();
      const count = output ? output.split("\n").length : 0;
      let text = theme.fg("success", `${count} entries`);
      if (details?.truncation?.truncated || details?.entryLimitReached) text += theme.fg("warning", " truncated");
      if (expanded && output) text += `\n${preview(output, OUTPUT_PREVIEW_LINES, (line) => theme.fg("toolOutput", line))}`;
      return new Text(text, 0, 0);
    },
  });
}
