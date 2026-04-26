import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import { Markdown, Text, matchesKey, type Component } from "@mariozechner/pi-tui";

const SHORTCUT = "alt+o";

function extractTextBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  return content
    .filter((block): block is { type: "text"; text: string } => {
      return (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string" &&
        block.text.trim().length > 0
      );
    })
    .map((block) => block.text);
}

function getLastAssistantResponse(entries: SessionEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;

    const text = extractTextBlocks(entry.message.content).join("\n\n").trim();
    if (text) return text;
  }

  return undefined;
}

class LastResponseViewer implements Component {
  private readonly title: Text;
  private readonly markdown: Markdown;
  private scrollOffset = 0;
  private visibleBodyLines = 1;
  private bodyLineCount = 0;

  constructor(
    private readonly response: string,
    private readonly terminalRows: () => number,
    private readonly requestRender: () => void,
    private readonly close: () => void,
    private readonly theme: Theme,
  ) {
    this.title = new Text(theme.fg("accent", theme.bold("Last assistant response")), 1, 0);
    this.markdown = new Markdown(response, 1, 1, getMarkdownTheme());
  }

  render(width: number): string[] {
    const titleLines = this.title.render(width);
    const bodyLines = this.markdown.render(width);
    this.bodyLineCount = bodyLines.length;

    const initialFooter = new Text(
      this.theme.fg(
        "dim",
        "j/e/f/down and k/y/b/up scroll, d/u half page, g/G top/bottom, q/esc quit",
      ),
      1,
      0,
    );
    this.visibleBodyLines = Math.max(
      1,
      this.terminalRows() - titleLines.length - initialFooter.render(width).length,
    );
    this.clampScroll();

    const firstLine = Math.min(this.scrollOffset + 1, this.bodyLineCount || 1);
    const lastLine = this.bodyLineCount
      ? Math.min(this.scrollOffset + this.visibleBodyLines, this.bodyLineCount)
      : 1;
    const footerText = `Line ${firstLine}-${lastLine} of ${this.bodyLineCount || 1} - j/e/f/down and k/y/b/up scroll, d/u half page, g/G top/bottom, q/esc quit`;
    const footer = new Text(this.theme.fg("dim", footerText), 1, 0);

    return [
      ...titleLines,
      ...bodyLines.slice(this.scrollOffset, this.scrollOffset + this.visibleBodyLines),
      ...footer.render(width),
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.close();
      return;
    }

    if (matchesKey(data, "up") || data === "k" || data === "y" || data === "b") {
      this.scrollOffset--;
    } else if (matchesKey(data, "down") || data === "j" || data === "e" || data === "f") {
      this.scrollOffset++;
    } else if (data === "u") {
      this.scrollOffset -= Math.max(1, Math.floor(this.visibleBodyLines / 2));
    } else if (data === "d") {
      this.scrollOffset += Math.max(1, Math.floor(this.visibleBodyLines / 2));
    } else if (data === "g") {
      this.scrollOffset = 0;
    } else if (data === "G") {
      this.scrollOffset = this.bodyLineCount;
    } else {
      return;
    }

    this.clampScroll();
    this.requestRender();
  }

  invalidate(): void {
    this.title.invalidate();
    this.markdown.setText(this.response);
    this.markdown.invalidate();
  }

  private clampScroll(): void {
    this.scrollOffset = Math.max(
      0,
      Math.min(this.scrollOffset, Math.max(0, this.bodyLineCount - this.visibleBodyLines)),
    );
  }
}

async function showLastResponse(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;

  const response = getLastAssistantResponse(ctx.sessionManager.getBranch());
  if (!response) {
    ctx.ui.notify("No assistant response found", "warning");
    return;
  }

  let requestFullRender = (): void => {};

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      requestFullRender = () => tui.requestRender(true);

      return new LastResponseViewer(
        response,
        () => tui.terminal.rows,
        () => tui.requestRender(),
        () => {
          done(undefined);
          tui.requestRender(true);
        },
        theme,
      );
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "top-left",
        row: 0,
        col: 0,
        width: "100%",
        maxHeight: "100%",
      },
    },
  );

  requestFullRender();
}

export default function (pi: ExtensionAPI) {
  pi.registerShortcut(SHORTCUT, {
    description: "Render the last assistant response with pi TUI",
    handler: showLastResponse,
  });
}
