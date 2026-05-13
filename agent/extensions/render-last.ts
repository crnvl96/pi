import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";

type LastPosition = {
  entryId: string;
  cursorLine: number;
  scrollTop: number;
};

type LastAssistantResponse = {
  entryId: string;
  text: string;
};

function lastAssistantResponse(ctx: ExtensionContext): LastAssistantResponse | undefined {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;

    const message = entry.message;
    if (!("role" in message) || message.role !== "assistant") continue;

    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trimEnd();

    if (text.trim().length > 0) {
      return { entryId: entry.id, text };
    }
  }

  return undefined;
}

function fitLine(line: string, width: number): string {
  if (width <= 0) return "";

  const clipped = truncateToWidth(line, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

const sgrReset = String.fromCharCode(27) + "[0m";
const sgrResetPattern = new RegExp(`${String.fromCharCode(27)}\\[0m`, "g");

function makeBackgroundWrapper(bg: (text: string) => string): (text: string) => string {
  const sample = bg("x");
  const markerIndex = sample.indexOf("x");
  if (markerIndex === -1) return bg;

  const start = sample.slice(0, markerIndex);
  const end = sample.slice(markerIndex + 1);

  return (text: string) => `${start}${text.replace(sgrResetPattern, `${sgrReset}${start}`)}${end}`;
}

class LastResponseOverlay implements Component {
  private cursorLine: number;
  private scrollTop: number;
  private cachedWidth?: number;
  private cachedRenderedLines?: string[];
  private readonly highlight: (text: string) => string;

  constructor(
    private readonly text: string,
    private readonly tui: TUI,
    startPosition: Omit<LastPosition, "entryId"> | undefined,
    selectedBg: (text: string) => string,
    private readonly onClose: (position: Omit<LastPosition, "entryId">) => void,
  ) {
    this.cursorLine = startPosition?.cursorLine ?? 0;
    this.scrollTop = startPosition?.scrollTop ?? 0;
    this.highlight = makeBackgroundWrapper(selectedBg);
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.enter) ||
      data === "q" ||
      data === "Q"
    ) {
      this.close();
      return;
    }

    if (data === "g") {
      this.goTo(0);
    } else if (data === "G") {
      this.goTo(Number.POSITIVE_INFINITY);
    } else if (data === "d") {
      this.moveCursor(this.halfPageSize());
    } else if (data === "u") {
      this.moveCursor(-this.halfPageSize());
    } else if (matchesKey(data, Key.down)) {
      this.moveCursor(1);
    } else if (matchesKey(data, Key.up)) {
      this.moveCursor(-1);
    } else {
      return;
    }

    this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = this.visibleHeight();
    const contentWidth = Math.max(1, width);
    const renderedLines = this.renderMarkdown(contentWidth);
    this.clampPosition(renderedLines.length, height);

    const lines: string[] = [];
    for (let row = 0; row < height; row++) {
      const lineIndex = this.scrollTop + row;
      const rawLine = renderedLines[lineIndex] ?? "";
      const fitted = fitLine(rawLine, contentWidth);
      lines.push(lineIndex === this.cursorLine ? this.highlight(fitted) : fitted);
    }

    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedRenderedLines = undefined;
  }

  private renderMarkdown(width: number): string[] {
    if (this.cachedRenderedLines && this.cachedWidth === width) {
      return this.cachedRenderedLines;
    }

    const markdown = new Markdown(this.text, 0, 0, getMarkdownTheme());
    const lines = markdown.render(width);
    this.cachedWidth = width;
    this.cachedRenderedLines = lines.length > 0 ? lines : [""];
    return this.cachedRenderedLines;
  }

  private visibleHeight(): number {
    return Math.max(1, this.tui.terminal.rows);
  }

  private halfPageSize(): number {
    return Math.max(1, Math.floor(this.visibleHeight() / 2));
  }

  private moveCursor(delta: number): void {
    const renderedLines = this.renderMarkdown(Math.max(1, this.tui.terminal.columns));
    this.cursorLine += delta;
    this.clampPosition(renderedLines.length, this.visibleHeight());
  }

  private goTo(line: number): void {
    const renderedLines = this.renderMarkdown(Math.max(1, this.tui.terminal.columns));
    this.cursorLine = line;
    this.clampPosition(renderedLines.length, this.visibleHeight());
  }

  private clampPosition(totalLines: number, height: number): void {
    const lastLine = Math.max(0, totalLines - 1);
    this.cursorLine = Math.max(0, Math.min(this.cursorLine, lastLine));

    if (this.cursorLine < this.scrollTop) {
      this.scrollTop = this.cursorLine;
    } else if (this.cursorLine >= this.scrollTop + height) {
      this.scrollTop = this.cursorLine - height + 1;
    }

    const maxScroll = Math.max(0, totalLines - height);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));
  }

  private close(): void {
    this.onClose({ cursorLine: this.cursorLine, scrollTop: this.scrollTop });
  }
}

export default function (pi: ExtensionAPI) {
  let lastPosition: LastPosition | undefined;

  async function renderLast(ctx: ExtensionContext) {
    if (!ctx.hasUI) {
      ctx.ui.notify("render-last requires interactive mode", "error");
      return;
    }

    const response = lastAssistantResponse(ctx);
    if (!response) {
      ctx.ui.notify("No assistant response found", "info");
      return;
    }

    const startPosition = lastPosition?.entryId === response.entryId ? lastPosition : undefined;

    await ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) =>
        new LastResponseOverlay(
          response.text,
          tui,
          startPosition,
          (text: string) => theme.bg("selectedBg", text),
          (position) => {
            lastPosition = { entryId: response.entryId, ...position };
            done();
          },
        ),
      {
        overlay: true,
        overlayOptions: {
          anchor: "top-left",
          row: 0,
          col: 0,
          width: "100%",
          maxHeight: "100%",
          margin: 0,
        },
      },
    );
  }

  pi.registerCommand("render-last", {
    description: "Render the last assistant response in a full-screen Markdown overlay",
    handler: async (_args, ctx) => renderLast(ctx),
  });

  pi.registerShortcut("ctrl+,", {
    description: "Render the last assistant response",
    handler: renderLast,
  });
}
