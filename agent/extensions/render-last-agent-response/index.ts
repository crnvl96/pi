import { getMarkdownTheme, type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@mariozechner/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";

const CHROME_LINES = 4;
const TAB_REPLACEMENT = "    ";

class LastResponseOverlay implements Component {
  private readonly markdown: Markdown;
  private scroll = 0;
  private cachedWidth?: number;
  private cachedMarkdownLines?: string[];

  constructor(
    response: string,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: () => void,
  ) {
    this.markdown = new Markdown(response, 0, 0, getMarkdownTheme());
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

    const title = this.theme.fg("accent", this.theme.bold("Last assistant response"));
    const help = this.theme.fg("dim", "up/down line | d/u half page | g/G top/bottom | esc/q quit");
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
  }

  private move(delta: number): void {
    this.scroll = Math.max(0, this.scroll + delta);
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
    return this.cachedMarkdownLines;
  }

}

function findLastAssistantResponse(ctx: ExtensionCommandContext): string | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i] as any;
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;

    const text = extractText(entry.message.content).trim();
    if (text) return text;
  }
  return undefined;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block): block is { type: string; text: string } =>
      block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n\n");
}

function fit(text: string, width: number): string {
  const maxWidth = Math.max(0, width);
  const normalized = text.replace(/\t/g, TAB_REPLACEMENT);
  const fitted = truncateToWidth(normalized, maxWidth, "...", true);
  if (visibleWidth(fitted) <= maxWidth) return fitted;
  return truncateToWidth(fitted, maxWidth, "", true);
}

export default function renderLastAgentResponseExtension(pi: ExtensionAPI) {
  pi.registerCommand("ext:render-last-agent-response", {
    description: "Render the last assistant response as markdown in a full-screen scrollable overlay",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const response = findLastAssistantResponse(ctx);
      if (!response) {
        ctx.ui.notify("No assistant response found", "warning");
        return;
      }

      if (!ctx.hasUI) {
        pi.sendMessage(
          { customType: "render-last-agent-response", content: response, display: true },
          { triggerTurn: false },
        );
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) =>
          new LastResponseOverlay(response, tui, theme, () => done(undefined)),
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
