import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import { Markdown, Text, matchesKey, type Component } from "@mariozechner/pi-tui";

const VIEWER_TITLE = "Last assistant response";
const SCROLL_HELP_TEXT =
  "j/e/f/down and k/y/b/up scroll, d/u half page, g/G top/bottom, q/esc quit";
const VIEWER_SHORTCUT = "alt+o";
const VIEWER_SHORTCUT_DESCRIPTION = "Render the last assistant response with pi TUI";
const VIEWER_OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: {
    anchor: "top-left",
    row: 0,
    col: 0,
    width: "100%",
    maxHeight: "100%",
  },
} as const;

type ScrollAction =
  | "close"
  | "lineUp"
  | "lineDown"
  | "halfPageUp"
  | "halfPageDown"
  | "top"
  | "bottom";

type VisibleLineRange = {
  firstLine: number;
  lastLine: number;
};

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

function getScrollAction(data: string): ScrollAction | undefined {
  if (matchesKey(data, "escape") || data === "q") return "close";
  if (matchesKey(data, "up") || data === "k" || data === "y" || data === "b") {
    return "lineUp";
  }
  if (matchesKey(data, "down") || data === "j" || data === "e" || data === "f") {
    return "lineDown";
  }
  if (data === "u") return "halfPageUp";
  if (data === "d") return "halfPageDown";
  if (data === "g") return "top";
  if (data === "G") return "bottom";

  return undefined;
}

class LastResponseViewer implements Component {
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
    this.markdown = new Markdown(response, 1, 1, getMarkdownTheme());
  }

  render(width: number): string[] {
    const titleLines = this.renderTitle(width);
    const bodyLines = this.renderBody(width);
    const footerLinesForLayout = this.renderFooterForLayout(width);

    this.visibleBodyLines = this.getVisibleBodyLineCount(
      titleLines.length,
      footerLinesForLayout.length,
    );
    this.clampScroll();

    const lineRange = this.getVisibleLineRange();
    const visibleBodyLines = bodyLines.slice(
      this.scrollOffset,
      this.scrollOffset + this.visibleBodyLines,
    );

    return [...titleLines, ...visibleBodyLines, ...this.renderFooter(width, lineRange)];
  }

  handleInput(data: string): void {
    const action = getScrollAction(data);
    if (!action) return;

    if (action === "close") {
      this.close();
      return;
    }

    this.applyScrollAction(action);
    this.clampScroll();
    this.requestRender();
  }

  invalidate(): void {
    this.markdown.setText(this.response);
    this.markdown.invalidate();
  }

  private renderTitle(width: number): string[] {
    return new Text(this.theme.fg("accent", this.theme.bold(VIEWER_TITLE)), 1, 0).render(width);
  }

  private renderBody(width: number): string[] {
    const bodyLines = this.markdown.render(width);
    this.bodyLineCount = bodyLines.length;
    return bodyLines;
  }

  private renderFooterForLayout(width: number): string[] {
    return new Text(this.theme.fg("dim", SCROLL_HELP_TEXT), 1, 0).render(width);
  }

  private renderFooter(width: number, lineRange: VisibleLineRange): string[] {
    const lineText = `Line ${lineRange.firstLine}-${lineRange.lastLine} of ${this.bodyLineCount || 1}`;
    const footerText = `${lineText} - ${SCROLL_HELP_TEXT}`;
    return new Text(this.theme.fg("dim", footerText), 1, 0).render(width);
  }

  private getVisibleBodyLineCount(titleLineCount: number, footerLineCount: number): number {
    return Math.max(1, this.terminalRows() - titleLineCount - footerLineCount);
  }

  private getVisibleLineRange(): VisibleLineRange {
    const totalLines = this.bodyLineCount || 1;
    const firstLine = Math.min(this.scrollOffset + 1, totalLines);
    const lastLine = this.bodyLineCount
      ? Math.min(this.scrollOffset + this.visibleBodyLines, this.bodyLineCount)
      : 1;

    return { firstLine, lastLine };
  }

  private applyScrollAction(action: Exclude<ScrollAction, "close">): void {
    if (action === "lineUp") {
      this.scrollOffset--;
    } else if (action === "lineDown") {
      this.scrollOffset++;
    } else if (action === "halfPageUp") {
      this.scrollOffset -= Math.max(1, Math.floor(this.visibleBodyLines / 2));
    } else if (action === "halfPageDown") {
      this.scrollOffset += Math.max(1, Math.floor(this.visibleBodyLines / 2));
    } else if (action === "top") {
      this.scrollOffset = 0;
    } else {
      this.scrollOffset = this.bodyLineCount;
    }
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

  let requestBaseScreenRender = (): void => {};

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      requestBaseScreenRender = () => tui.requestRender(true);

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
    VIEWER_OVERLAY_OPTIONS,
  );

  requestBaseScreenRender();
}

export default function renderLastResponseExtension(pi: ExtensionAPI) {
  pi.registerShortcut(VIEWER_SHORTCUT, {
    description: VIEWER_SHORTCUT_DESCRIPTION,
    handler: showLastResponse,
  });
}
