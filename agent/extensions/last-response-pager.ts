// Last response pager extension.
//
// Purpose:
// - Long assistant responses can push their beginning into terminal scrollback.
// - This extension opens long assistant responses in a focused pager overlay.
// - The pager starts at the first line, so reading can begin immediately.
//
// Behavior:
// - Automatically opens after an agent run if the last assistant text is taller
//   than the available pager body height.
// - Does not auto-open while queued messages are pending.
// - Provides `/last` to manually reopen the last assistant response.
//
// Pager controls:
// - j/k or Up/Down: scroll one line.
// - Space/PageDown or PageUp: scroll one page.
// - g/G or Home/End: jump to top or bottom.
// - q, Escape, or Ctrl+C: close.

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const HORIZONTAL_PADDING = 2;
const CHROME_LINES = 4;
const MIN_VISIBLE_BODY_LINES = 6;
const MAX_VISIBLE_BODY_LINES = 40;

type TextPart = {
  type: "text";
  text: string;
};

type AssistantLike = {
  role: string;
  content?: unknown;
};

export function assistantText(message: unknown): string | undefined {
  const candidate = message as AssistantLike;
  if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) {
    return undefined;
  }

  const parts = candidate.content
    .filter((part): part is TextPart => {
      return typeof part === "object" && part !== null && (part as TextPart).type === "text";
    })
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0);

  return parts.length > 0 ? parts.join("\n\n").replace(/^\n+|\n+$/g, "") : undefined;
}

export function findLastAssistantText(messages: readonly unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = assistantText(messages[i]);
    if (text) {
      return text;
    }
  }

  return undefined;
}

export function wrapLines(text: string, width: number): string[] {
  const contentWidth = Math.max(1, width);
  const lines: string[] = [];

  for (const line of text.split("\n")) {
    if (line.length === 0) {
      lines.push("");
      continue;
    }

    lines.push(...wrapTextWithAnsi(line, contentWidth));
  }

  return lines;
}

export function shouldAutoOpen(text: string, columns: number, rows: number): boolean {
  const innerWidth = Math.max(20, columns - HORIZONTAL_PADDING - 2);
  const visibleBodyLines = getVisibleBodyLines(rows);
  return wrapLines(text, innerWidth).length > visibleBodyLines;
}

function getVisibleBodyLines(rows: number): number {
  const available = rows - CHROME_LINES - 2;
  return Math.max(MIN_VISIBLE_BODY_LINES, Math.min(MAX_VISIBLE_BODY_LINES, available));
}

function padToWidth(text: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(text));
  return text + " ".repeat(padding);
}

class AssistantPager {
  private offset = 0;
  private cachedWidth = 0;
  private cachedRows = 0;
  private cachedLines: string[] = [];

  constructor(
    private readonly tui: TUI,
    private readonly text: string,
    private readonly done: () => void,
    private readonly theme: ExtensionContext["ui"]["theme"],
  ) {}

  handleInput(data: string): void {
    const pageSize = Math.max(1, this.visibleBodyLines() - 1);
    const maxOffset = this.maxOffset();
    let nextOffset = this.offset;

    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
      this.done();
      return;
    }

    if (matchesKey(data, "up") || data === "k") {
      nextOffset--;
    } else if (matchesKey(data, "down") || data === "j") {
      nextOffset++;
    } else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+b")) {
      nextOffset -= pageSize;
    } else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+f") || data === " ") {
      nextOffset += pageSize;
    } else if (matchesKey(data, "home") || data === "g") {
      nextOffset = 0;
    } else if (matchesKey(data, "end") || data === "G") {
      nextOffset = maxOffset;
    } else {
      return;
    }

    this.offset = Math.max(0, Math.min(maxOffset, nextOffset));
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(24, width);
    const innerWidth = Math.max(1, safeWidth - 2);
    const bodyWidth = Math.max(1, innerWidth - HORIZONTAL_PADDING);
    const bodyLines = this.getLines(bodyWidth);
    const visibleBodyLines = this.visibleBodyLines();
    const maxOffset = Math.max(0, bodyLines.length - visibleBodyLines);
    this.offset = Math.max(0, Math.min(maxOffset, this.offset));

    const end = Math.min(bodyLines.length, this.offset + visibleBodyLines);
    const title = ` Last assistant response ${bodyLines.length === 0 ? "0/0" : `${this.offset + 1}-${end}/${bodyLines.length}`} `;
    const top = this.borderLine(innerWidth, title);
    const output = [top];

    for (const line of bodyLines.slice(this.offset, end)) {
      output.push(this.bodyLine(line, bodyWidth, innerWidth));
    }

    for (let i = end - this.offset; i < visibleBodyLines; i++) {
      output.push(this.bodyLine("", bodyWidth, innerWidth));
    }

    const help = " j/k up/down | space page | g/G top/bottom | q/esc close ";
    output.push(this.bodyLine(this.theme.fg("dim", help), bodyWidth, innerWidth));
    output.push(this.theme.fg("border", `+${"-".repeat(innerWidth)}+`));

    return output.map((line) => truncateToWidth(line, safeWidth, "", true));
  }

  invalidate(): void {
    this.cachedWidth = 0;
    this.cachedRows = 0;
    this.cachedLines = [];
  }

  private visibleBodyLines(): number {
    return getVisibleBodyLines(this.tui.terminal.rows);
  }

  private getLines(width: number): string[] {
    const rows = this.tui.terminal.rows;
    if (this.cachedWidth !== width || this.cachedRows !== rows) {
      this.cachedWidth = width;
      this.cachedRows = rows;
      this.cachedLines = wrapLines(this.text, width);
    }

    return this.cachedLines;
  }

  private maxOffset(): number {
    const bodyWidth = Math.max(1, this.tui.terminal.columns - HORIZONTAL_PADDING - 2);
    return Math.max(0, this.getLines(bodyWidth).length - this.visibleBodyLines());
  }

  private borderLine(width: number, title: string): string {
    const safeTitle = truncateToWidth(title, width, "");
    const right = Math.max(0, width - visibleWidth(safeTitle));
    return (
      this.theme.fg("border", "+") +
      this.theme.fg("accent", safeTitle) +
      this.theme.fg("border", `${"-".repeat(right)}+`)
    );
  }

  private bodyLine(line: string, bodyWidth: number, innerWidth: number): string {
    const body = padToWidth(truncateToWidth(line, bodyWidth, "", true), bodyWidth);
    const text = " ".repeat(HORIZONTAL_PADDING / 2) + body + " ".repeat(HORIZONTAL_PADDING / 2);
    return (
      this.theme.fg("border", "|") + padToWidth(text, innerWidth) + this.theme.fg("border", "|")
    );
  }
}

async function openPager(ctx: ExtensionContext, text: string): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _kb, done) => new AssistantPager(tui, text, done, theme), {
    overlay: true,
    overlayOptions: {
      anchor: "top-center",
      width: "100%",
      maxHeight: "95%",
      margin: { top: 1, left: 1, right: 1 },
    },
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("last", {
    description: "Open the last assistant response in a pager",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      const text = findLastAssistantText(
        ctx.sessionManager.getBranch().map((entry) => {
          return entry.type === "message" ? entry.message : undefined;
        }),
      );

      if (!text) {
        ctx.ui.notify("No assistant response to show", "warning");
        return;
      }

      await openPager(ctx, text);
    },
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!ctx.hasUI || ctx.hasPendingMessages()) {
      return;
    }

    const text = findLastAssistantText(event.messages);
    if (!text) {
      return;
    }

    const columns = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
    if (!shouldAutoOpen(text, columns, rows)) {
      return;
    }

    await openPager(ctx, text);
  });
}
