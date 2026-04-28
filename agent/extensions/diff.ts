import { getMarkdownTheme, type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@mariozechner/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";

const CHROME_LINES = 4;
const TAB_REPLACEMENT = "    ";
const WRITE_PREVIEW_MAX_LINES = 80;
const WRITE_PREVIEW_MAX_CHARS = 12_000;

type ToolName = "edit" | "write";

interface ToolCallBlock {
  type: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

interface ToolResultMessage {
  role: string;
  toolCallId?: string;
  toolName?: string;
  content?: unknown;
  details?: unknown;
  isError?: boolean;
}

interface MutationCall {
  toolName: ToolName;
  toolCallId?: string;
  args: Record<string, unknown>;
  result?: ToolResultMessage;
}

interface DiffDocument {
  markdown: string;
  anchors: string[];
}

export default function diffExtension(pi: ExtensionAPI) {
  pi.registerCommand("diff", {
    description: "Render edit/write tool calls since the last user message in a scrollable overlay",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const diff = findRecentEditAndWriteCalls(ctx);
      if (!diff) {
        ctx.ui.notify("No edit or write tool calls found since the last user message", "warning");
        return;
      }

      if (!ctx.hasUI) {
        pi.sendMessage(
          { customType: "diff", content: diff.markdown, display: true },
          { triggerTurn: false },
        );
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) =>
          new DiffOverlay(diff, tui, theme, () => done(undefined)),
        {
          overlay: true,
          overlayOptions: {
            anchor: "top-left",
            width: "100%",
            maxHeight: "100%",
            margin: 0,
          },
        },
      );
    },
  });
}

class DiffOverlay implements Component {
  private readonly markdown: Markdown;
  private scroll = 0;
  private cachedWidth?: number;
  private cachedMarkdownLines?: string[];
  private cachedAnchorOffsets?: number[];

  constructor(
    private readonly document: DiffDocument,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: () => void,
  ) {
    this.markdown = new Markdown(document.markdown, 0, 0, getMarkdownTheme());
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data.toLowerCase() === "q") {
      this.done();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.move(1);
      return;
    }
    if (data === "u") {
      this.move(-this.halfPageSize());
      return;
    }
    if (data === "d") {
      this.move(this.halfPageSize());
      return;
    }
    if (data === "n") {
      this.jumpFile(1);
      return;
    }
    if (data === "N") {
      this.jumpFile(-1);
      return;
    }
    if (data === "g") {
      this.scroll = 0;
      this.tui.requestRender();
      return;
    }
    if (data === "G") {
      this.scroll = Number.MAX_SAFE_INTEGER;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    if (width <= 0) return [];

    const bodyHeight = this.bodyHeight();
    const markdownLines = this.getMarkdownLines(width);
    const maxScroll = Math.max(0, markdownLines.length - bodyHeight);
    this.scroll = Math.max(0, Math.min(maxScroll, this.scroll));

    const title = this.theme.fg("accent", this.theme.bold("Edit/write tools since last user message"));
    const help = this.theme.fg("dim", "up/down line | d/u half page | n/N next/prev file | g/G top/bottom | esc/q quit");
    const position = this.theme.fg(
      "dim",
      `${markdownLines.length === 0 ? 0 : this.scroll + 1}-${Math.min(markdownLines.length, this.scroll + bodyHeight)} of ${markdownLines.length}`,
    );

    const lines: string[] = [];
    lines.push(fit(title, width));
    lines.push(fit(help, width));
    lines.push(fit("", width));

    const visible = markdownLines.slice(this.scroll, this.scroll + bodyHeight);
    while (visible.length < bodyHeight) visible.push("");
    for (const line of visible) {
      lines.push(fit(line, width));
    }

    lines.push(fit(position, width));
    return lines;
  }

  invalidate(): void {
    this.markdown.invalidate();
    this.cachedWidth = undefined;
    this.cachedMarkdownLines = undefined;
    this.cachedAnchorOffsets = undefined;
  }

  private move(delta: number): void {
    this.scroll = Math.max(0, this.scroll + delta);
    this.tui.requestRender();
  }

  private jumpFile(delta: 1 | -1): void {
    const width = this.cachedWidth ?? Math.max(1, this.tui.terminal.columns);
    this.getMarkdownLines(width);

    const offsets = this.cachedAnchorOffsets ?? [];
    if (offsets.length === 0) return;

    let target: number | undefined;
    if (delta > 0) {
      target = offsets.find((offset) => offset > this.scroll) ?? offsets[0];
    } else {
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (offsets[i]! < this.scroll) {
          target = offsets[i];
          break;
        }
      }
      target ??= offsets[offsets.length - 1];
    }

    this.scroll = target ?? 0;
    this.tui.requestRender();
  }

  private halfPageSize(): number {
    return Math.max(1, Math.floor(this.bodyHeight() / 2));
  }

  private bodyHeight(): number {
    const terminalRows = Math.max(CHROME_LINES + 1, this.tui.terminal.rows);
    return Math.max(1, terminalRows - CHROME_LINES);
  }

  private getMarkdownLines(width: number): string[] {
    if (this.cachedWidth === width && this.cachedMarkdownLines) return this.cachedMarkdownLines;
    this.cachedWidth = width;
    this.cachedMarkdownLines = this.markdown.render(width).map((line) => fit(line, width));
    this.cachedAnchorOffsets = findAnchorOffsets(this.cachedMarkdownLines, this.document.anchors);
    return this.cachedMarkdownLines;
  }
}

function findAnchorOffsets(lines: string[], anchors: string[]): number[] {
  const offsets: number[] = [];
  let searchFrom = 0;

  for (const anchor of anchors) {
    for (let i = searchFrom; i < lines.length; i++) {
      if (stripAnsi(lines[i] ?? "").trim().includes(anchor)) {
        offsets.push(i);
        searchFrom = i + 1;
        break;
      }
    }
  }

  return offsets;
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "");
}

function findRecentEditAndWriteCalls(ctx: ExtensionCommandContext): DiffDocument | undefined {
  const branch = ctx.sessionManager.getBranch();
  const lastUserIndex = findLastUserMessageIndex(branch);
  const resultByToolCallId = collectToolResults(branch);
  const calls: MutationCall[] = [];

  for (let i = 0; i < branch.length; i++) {
    const entry = asRecord(branch[i]);
    if (entry?.type !== "message") continue;

    const message = asRecord(entry.message);
    if (message?.role !== "assistant") continue;

    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      const toolCall = asToolCallBlock(block);
      if (!toolCall) continue;

      if (i <= lastUserIndex) continue;
      if (!isMutationToolName(toolCall.name)) continue;

      const args = asRecord(toolCall.arguments) ?? {};
      calls.push({
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        args,
        result: toolCall.id ? resultByToolCallId.get(toolCall.id) : undefined,
      });
    }
  }

  if (calls.length === 0) return undefined;
  return renderCalls(calls);
}

function findLastUserMessageIndex(branch: unknown[]): number {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = asRecord(branch[i]);
    if (entry?.type !== "message") continue;

    const message = asRecord(entry.message);
    if (message?.role === "user") return i;
  }
  return -1;
}

function collectToolResults(branch: unknown[]): Map<string, ToolResultMessage> {
  const results = new Map<string, ToolResultMessage>();
  for (const item of branch) {
    const entry = asRecord(item);
    if (entry?.type !== "message") continue;

    const message = asToolResultMessage(entry.message);
    if (!message?.toolCallId) continue;
    results.set(message.toolCallId, message);
  }
  return results;
}

function renderCalls(calls: MutationCall[]): DiffDocument {
  const lines: string[] = [];
  const anchors: string[] = [];

  calls.forEach((call, index) => {
    const heading = callHeading(call, index + 1, calls.length);
    anchors.push(heading);
    lines.push(renderCall(call, heading));
  });

  return { markdown: lines.join("\n\n"), anchors };
}

function renderCall(call: MutationCall, heading: string): string {
  const path = getString(call.args, "path") ?? "(unknown path)";
  const lines: string[] = [`## ${heading}`, "", `- Path: \`${path}\``];

  if (call.toolCallId) lines.push(`- Tool call ID: \`${call.toolCallId}\``);
  if (call.result?.isError) lines.push("- Result: error");
  lines.push("");

  if (call.toolName === "edit") {
    lines.push(...renderEditCall(call));
  } else {
    lines.push(...renderWriteCall(call));
  }

  return lines.join("\n");
}

function callHeading(call: MutationCall, current: number, total: number): string {
  return `agent: ${call.toolName} [${current}/${total}]`;
}

function renderEditCall(call: MutationCall): string[] {
  const diff = getResultDiff(call.result);
  if (diff) return ["### Applied diff", "", codeFence(diff, "diff")];

  const edits = getEditBlocks(call.args);
  if (edits.length === 0) return ["### Arguments", "", codeFence(JSON.stringify(call.args, null, 2), "json")];

  const lines: string[] = ["### Requested edits"];
  edits.forEach((edit, index) => {
    lines.push("", `#### Edit ${index + 1}`, "", "Old:", "", codeFence(edit.oldText, "text"));
    lines.push("", "New:", "", codeFence(edit.newText, "text"));
  });
  return lines;
}

function renderWriteCall(call: MutationCall): string[] {
  const content = getString(call.args, "content");
  if (content === undefined) return ["### Arguments", "", codeFence(JSON.stringify(call.args, null, 2), "json")];

  const path = getString(call.args, "path");
  const preview = createWritePreview(content);
  const lines = [
    "### Full file written",
    "",
    `- Lines: ${countLines(content)}`,
    `- Size: ${formatBytes(Buffer.byteLength(content, "utf8"))}`,
    preview.truncated
      ? `- Preview: first ${preview.previewLines} lines / ${formatBytes(Buffer.byteLength(preview.content, "utf8"))}`
      : "- Preview: full content",
    "",
    "### Content preview",
    "",
    codeFence(preview.content, languageForPath(path)),
  ];

  if (preview.truncated) {
    lines.push("", "Preview truncated to keep the overlay compact. The write tool replaced the full file content.");
  }

  return lines;
}

function createWritePreview(content: string): { content: string; previewLines: number; truncated: boolean } {
  const allLines = content.split("\n");
  let preview = allLines.slice(0, WRITE_PREVIEW_MAX_LINES).join("\n");
  let truncated = allLines.length > WRITE_PREVIEW_MAX_LINES;

  if (preview.length > WRITE_PREVIEW_MAX_CHARS) {
    preview = preview.slice(0, WRITE_PREVIEW_MAX_CHARS);
    truncated = true;
  }

  return {
    content: preview,
    previewLines: countLines(preview),
    truncated,
  };
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getEditBlocks(args: Record<string, unknown>): Array<{ oldText: string; newText: string }> {
  const edits: Array<{ oldText: string; newText: string }> = [];
  if (Array.isArray(args.edits)) {
    for (const item of args.edits) {
      const edit = asRecord(item);
      const oldText = edit ? getString(edit, "oldText") : undefined;
      const newText = edit ? getString(edit, "newText") : undefined;
      if (oldText !== undefined && newText !== undefined) edits.push({ oldText, newText });
    }
  }

  const oldText = getString(args, "oldText");
  const newText = getString(args, "newText");
  if (oldText !== undefined && newText !== undefined) edits.push({ oldText, newText });

  return edits;
}

function getResultDiff(result: ToolResultMessage | undefined): string | undefined {
  const details = asRecord(result?.details);
  const diff = details ? getString(details, "diff") : undefined;
  return diff && diff.trim() ? diff : undefined;
}

function asToolCallBlock(value: unknown): ToolCallBlock | undefined {
  const block = asRecord(value);
  if (!block || block.type !== "toolCall") return undefined;
  const name = typeof block.name === "string" ? block.name : undefined;
  const id = typeof block.id === "string" ? block.id : undefined;
  return { type: "toolCall", id, name, arguments: block.arguments };
}

function asToolResultMessage(value: unknown): ToolResultMessage | undefined {
  const message = asRecord(value);
  if (!message || message.role !== "toolResult") return undefined;
  return {
    role: "toolResult",
    toolCallId: getString(message, "toolCallId"),
    toolName: getString(message, "toolName"),
    content: message.content,
    details: message.details,
    isError: typeof message.isError === "boolean" ? message.isError : undefined,
  };
}

function isMutationToolName(name: string | undefined): name is ToolName {
  return name === "edit" || name === "write";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function codeFence(content: string, language = ""): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  const suffix = language ? language : "";
  return `${fence}${suffix}\n${content}\n${fence}`;
}

function longestBacktickRun(content: string): number {
  let longest = 0;
  let current = 0;
  for (const char of content) {
    if (char === "`") {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function languageForPath(path: string | undefined): string {
  if (!path) return "text";
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) return "typescript";
  if (normalized.endsWith(".js") || normalized.endsWith(".jsx") || normalized.endsWith(".mjs")) return "javascript";
  if (normalized.endsWith(".json")) return "json";
  if (normalized.endsWith(".md")) return "markdown";
  if (normalized.endsWith(".py")) return "python";
  if (normalized.endsWith(".rs")) return "rust";
  if (normalized.endsWith(".go")) return "go";
  if (normalized.endsWith(".sh") || normalized.endsWith(".bash")) return "bash";
  if (normalized.endsWith(".css")) return "css";
  if (normalized.endsWith(".html")) return "html";
  if (normalized.endsWith(".yml") || normalized.endsWith(".yaml")) return "yaml";
  return "text";
}

function fit(text: string, width: number): string {
  const maxWidth = Math.max(0, width);
  const normalized = text.replace(/\t/g, TAB_REPLACEMENT);
  const fitted = truncateToWidth(normalized, maxWidth, "...", true);
  if (visibleWidth(fitted) <= maxWidth) return fitted;
  return truncateToWidth(fitted, maxWidth, "", true);
}
