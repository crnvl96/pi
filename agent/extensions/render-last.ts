import {
  copyToClipboard,
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

const pageJumpMarkerMs = 700;
const sgrReset = String.fromCharCode(27) + "[0m";
const sgrResetPattern = new RegExp(`${String.fromCharCode(27)}\\[0m`, "g");

function makeStyleWrapper(style: (text: string) => string): (text: string) => string {
  const sample = style("x");
  const markerIndex = sample.indexOf("x");
  if (markerIndex === -1) return style;

  const start = sample.slice(0, markerIndex);
  const end = sample.slice(markerIndex + 1);

  return (text: string) => `${start}${text.replace(sgrResetPattern, `${sgrReset}${start}`)}${end}`;
}

class LastResponseOverlay implements Component {
  private scrollTop: number;
  private cachedWidth?: number;
  private cachedRenderedLines?: string[];
  private pageJumpMarkerLine: number | undefined;
  private pageJumpMarkerStartedAt = 0;
  private pageJumpMarkerTimers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly footerStyle: (text: string) => string;
  private readonly pageJumpMarkerStrongStyle: (text: string) => string;
  private readonly pageJumpMarkerSoftStyle: (text: string) => string;

  constructor(
    private readonly text: string,
    private readonly tui: TUI,
    startPosition: Omit<LastPosition, "entryId"> | undefined,
    footerStyle: (text: string) => string,
    pageJumpMarkerStrongStyle: (text: string) => string,
    pageJumpMarkerSoftStyle: (text: string) => string,
    private readonly onCopy: () => void,
    private readonly onClose: (position: Omit<LastPosition, "entryId">) => void,
  ) {
    this.scrollTop = startPosition?.scrollTop ?? 0;
    this.footerStyle = makeStyleWrapper(footerStyle);
    this.pageJumpMarkerStrongStyle = makeStyleWrapper(pageJumpMarkerStrongStyle);
    this.pageJumpMarkerSoftStyle = makeStyleWrapper(pageJumpMarkerSoftStyle);
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

    if (data === "y") {
      this.onCopy();
      this.close();
      return;
    }

    if (data === "g") {
      this.scrollTo(0);
    } else if (data === "G") {
      this.scrollTo(Number.POSITIVE_INFINITY);
    } else if (data === "d") {
      this.scrollHalfPage(1);
    } else if (data === "u") {
      this.scrollHalfPage(-1);
    } else if (matchesKey(data, Key.down)) {
      this.scrollBy(1);
    } else if (matchesKey(data, Key.up)) {
      this.scrollBy(-1);
    } else {
      return;
    }

    this.tui.requestRender();
  }

  render(width: number): string[] {
    const contentHeight = this.contentHeight();
    const contentWidth = Math.max(1, width);
    const renderedLines = this.renderMarkdown(contentWidth);
    this.clampScroll(renderedLines.length, Math.max(1, contentHeight));

    const lines: string[] = [];
    for (let row = 0; row < contentHeight; row++) {
      const lineIndex = this.scrollTop + row;
      const rawLine = renderedLines[lineIndex] ?? "";
      const fitted = fitLine(rawLine, contentWidth);
      lines.push(this.styleContentLine(lineIndex, fitted));
    }
    lines.push(this.renderFooter(contentWidth, renderedLines.length, contentHeight));

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

  private contentHeight(): number {
    return Math.max(0, this.visibleHeight() - 1);
  }

  private halfPageSize(): number {
    return Math.max(1, Math.floor(Math.max(1, this.contentHeight()) / 2));
  }

  private scrollHalfPage(direction: 1 | -1): void {
    const markerLine =
      direction > 0 ? this.scrollTop + Math.max(1, this.contentHeight()) - 1 : this.scrollTop;
    const previousScrollTop = this.scrollTop;
    this.scrollBy(direction * this.halfPageSize());

    if (this.scrollTop !== previousScrollTop) {
      this.showPageJumpMarker(markerLine);
    }
  }

  private scrollBy(delta: number): void {
    const renderedLines = this.renderMarkdown(Math.max(1, this.tui.terminal.columns));
    this.scrollTop += delta;
    this.clampScroll(renderedLines.length, Math.max(1, this.contentHeight()));
  }

  private scrollTo(scrollTop: number): void {
    const renderedLines = this.renderMarkdown(Math.max(1, this.tui.terminal.columns));
    this.scrollTop = scrollTop;
    this.clampScroll(renderedLines.length, Math.max(1, this.contentHeight()));
  }

  private clampScroll(totalLines: number, height: number): void {
    const maxScroll = Math.max(0, totalLines - height);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));
  }

  private renderFooter(width: number, totalLines: number, contentHeight: number): string {
    const visibleLine = Math.min(totalLines, this.scrollTop + Math.max(1, contentHeight));
    const footer = `↑/↓ scroll • u/d half-page • g/G top/bottom • y copy • q/esc/enter close • ${visibleLine}/${totalLines}`;
    return this.footerStyle(fitLine(footer, width));
  }

  private styleContentLine(lineIndex: number, line: string): string {
    if (this.pageJumpMarkerLine !== lineIndex) return line;

    const ageMs = Date.now() - this.pageJumpMarkerStartedAt;
    if (ageMs >= pageJumpMarkerMs) return line;
    if (ageMs >= Math.floor(pageJumpMarkerMs / 2)) return this.pageJumpMarkerSoftStyle(line);

    return this.pageJumpMarkerStrongStyle(line);
  }

  private showPageJumpMarker(line: number): void {
    this.clearPageJumpMarkerTimers();
    this.pageJumpMarkerLine = line;
    this.pageJumpMarkerStartedAt = Date.now();

    for (const delayMs of [Math.floor(pageJumpMarkerMs / 2), pageJumpMarkerMs]) {
      this.pageJumpMarkerTimers.push(
        setTimeout(() => {
          if (delayMs >= pageJumpMarkerMs) {
            this.pageJumpMarkerLine = undefined;
          }
          this.tui.requestRender();
        }, delayMs),
      );
    }
  }

  private clearPageJumpMarkerTimers(): void {
    for (const timer of this.pageJumpMarkerTimers) clearTimeout(timer);
    this.pageJumpMarkerTimers = [];
  }

  private close(): void {
    this.clearPageJumpMarkerTimers();
    this.onClose({ scrollTop: this.scrollTop });
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
          (text: string) => theme.fg("dim", text),
          (text: string) => theme.bg("selectedBg", text),
          (text: string) => theme.fg("accent", text),
          () => {
            void copyToClipboard(response.text)
              .then(() => ctx.ui.notify("Copied overlay content to clipboard", "info"))
              .catch(() => ctx.ui.notify("Failed to copy overlay content", "error"));
          },
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
