/**
 * Q&A extraction hook - extracts questions from assistant responses
 *
 * Custom interactive TUI for answering questions.
 *
 * Demonstrates the "prompt generator" pattern with custom TUI:
 * 1. /answer command gets the last assistant message
 * 2. Shows a spinner while extracting questions as structured JSON
 * 3. Presents an interactive TUI to navigate and answer questions
 * 4. Submits the compiled answers when done
 */

import { complete, type Model, type Api, type UserMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";

// Structured output format for question extraction
interface ExtractedQuestion {
  question: string;
  context?: string;
}

interface ExtractionResult {
  questions: ExtractedQuestion[];
}

const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- If questions are organized as a numbered list, the question is only the text on the numbered line after the number
- For numbered-list questions, preserve all context below each question exactly as written until the next numbered question
- Preserve context markdown verbatim, including blockquotes, lists, code fences, and comments
- If no questions are found, return {"questions": []}

Example output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?"
    }
  ]
}`;

const CODEX_MODEL_ID = "gpt-5.4-mini";
const HAIKU_MODEL_ID = "claude-haiku-4-5";

async function selectExtractionModel(
  currentModel: Model<Api>,
  modelRegistry: ModelRegistry,
): Promise<Model<Api>> {
  const codexModel = modelRegistry.find("openai-codex", CODEX_MODEL_ID);
  if (codexModel) {
    const auth = await modelRegistry.getApiKeyAndHeaders(codexModel);
    if (auth.ok) {
      return codexModel;
    }
  }

  const haikuModel = modelRegistry.find("anthropic", HAIKU_MODEL_ID);
  if (!haikuModel) {
    return currentModel;
  }

  const auth = await modelRegistry.getApiKeyAndHeaders(haikuModel);
  if (auth.ok === false) {
    return currentModel;
  }

  return haikuModel;
}

/**
 * Parse the JSON response from the LLM
 */
function parseExtractionResult(text: string): ExtractionResult | null {
  try {
    // Try to find JSON in the response (it might be wrapped in markdown code blocks)
    let jsonStr = text;

    // Remove markdown code block if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.questions)) {
      return parsed as ExtractionResult;
    }
    return null;
  } catch {
    return null;
  }
}

function trimBlankBoundaryLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") {
    start++;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end--;
  }

  return lines.slice(start, end);
}

/**
 * Deterministically parse the expected numbered question format:
 *
 * 1. Question text
 * Context markdown until the next numbered question
 * 2. Next question
 *
 * Markdown code fences are respected so numbered lines inside fenced code are not split.
 */
function parseNumberedQuestionList(text: string): ExtractionResult | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const questions: Array<{ lineIndex: number; number: number; question: string }> = [];
  let fence: { char: "`" | "~"; length: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!fence) {
      const numberedMatch = line.match(/^(\d+)[.)][ \t]+(.+?)\s*$/);
      if (numberedMatch) {
        const number = Number(numberedMatch[1]);
        const previous = questions[questions.length - 1];
        if ((!previous && number === 1) || (previous && number === previous.number + 1)) {
          questions.push({ lineIndex: i, number, question: numberedMatch[2].trim() });
        }
      }

      const openFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (openFence) {
        const marker = openFence[1];
        fence = { char: marker[0] as "`" | "~", length: marker.length };
      }
      continue;
    }

    const closeFencePattern = new RegExp(`^ {0,3}\\${fence.char}{${fence.length},}`);
    if (closeFencePattern.test(line)) {
      fence = null;
    }
  }

  if (questions.length === 0) {
    return null;
  }

  return {
    questions: questions.map((question, index) => {
      const nextQuestion = questions[index + 1];
      const contextLines = trimBlankBoundaryLines(
        lines.slice(question.lineIndex + 1, nextQuestion?.lineIndex ?? lines.length),
      );
      return {
        question: question.question,
        context: contextLines.length > 0 ? contextLines.join("\n") : undefined,
      };
    }),
  };
}

/**
 * Interactive Q&A component for answering extracted questions
 */
class QnAComponent implements Component {
  private questions: ExtractedQuestion[];
  private answers: string[];
  private additionalNotes: string = "";
  private contextScrollOffsets: number[];
  private currentIndex: number = 0;
  private editor: Editor;
  private tui: TUI;
  private onDone: (result: string | null) => void;
  private showingNotesScreen: boolean = false;
  private showingConfirmation: boolean = false;
  private readonly maxContextLines = 12;
  private lastContextLineCount: number = 0;
  private lastContextViewportLines: number = 0;

  // Cache
  private cachedWidth?: number;
  private cachedLines?: string[];

  // Colors - using proper reset sequences
  private dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  private bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  private cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  private green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  private yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  private gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

  constructor(questions: ExtractedQuestion[], tui: TUI, onDone: (result: string | null) => void) {
    this.questions = questions;
    this.answers = questions.map(() => "");
    this.contextScrollOffsets = questions.map(() => 0);
    this.tui = tui;
    this.onDone = onDone;

    // Create a minimal theme for the editor
    const editorTheme: EditorTheme = {
      borderColor: this.dim,
      selectList: {
        selectedPrefix: this.cyan,
        selectedText: (s: string) => `\x1b[44m${s}\x1b[0m`,
        description: this.gray,
        scrollInfo: this.dim,
        noMatch: this.yellow,
      },
    };

    this.editor = new Editor(tui, editorTheme);
    // Disable the editor's built-in submit (which clears the editor)
    // We'll handle Enter ourselves to preserve the text
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      this.invalidate();
      this.tui.requestRender();
    };
  }

  private saveCurrentEditorText(): void {
    if (this.showingNotesScreen) {
      this.additionalNotes = this.editor.getText();
      return;
    }

    this.answers[this.currentIndex] = this.editor.getText();
  }

  private navigateTo(index: number): void {
    if (index < 0 || index >= this.questions.length) return;
    this.saveCurrentEditorText();
    this.showingNotesScreen = false;
    this.currentIndex = index;
    this.editor.setText(this.answers[index] || "");
    this.invalidate();
  }

  private navigateToNotes(): void {
    this.saveCurrentEditorText();
    this.showingNotesScreen = true;
    this.editor.setText(this.additionalNotes);
    this.invalidate();
  }

  private canScrollContext(): boolean {
    return this.lastContextLineCount > this.lastContextViewportLines;
  }

  private scrollContext(delta: number): boolean {
    if (!this.canScrollContext()) return false;

    const maxScroll = Math.max(0, this.lastContextLineCount - this.lastContextViewportLines);
    const current = this.contextScrollOffsets[this.currentIndex] ?? 0;
    const next = Math.max(0, Math.min(maxScroll, current + delta));
    if (next === current) return false;

    this.contextScrollOffsets[this.currentIndex] = next;
    this.invalidate();
    return true;
  }

  private renderMarkdown(text: string, width: number): string[] {
    const markdown = new Markdown(text, 0, 0, getMarkdownTheme());
    return markdown.render(width);
  }

  private submit(): void {
    this.saveCurrentEditorText();

    // Build the response text
    const parts: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const a = this.answers[i]?.trim() || "(no answer)";
      parts.push(`Q: ${q.question}`);
      if (q.context) {
        parts.push(`Context:\n${q.context}`);
      }
      parts.push(`A: ${a}`);
      parts.push("");
    }

    const notes = this.additionalNotes.trim();
    if (notes.length > 0) {
      parts.push("Additional notes:");
      parts.push(notes);
      parts.push("");
    }

    this.onDone(parts.join("\n").trim());
  }

  private cancel(): void {
    this.onDone(null);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    // Handle confirmation dialog
    if (this.showingConfirmation) {
      if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
        this.submit();
        return;
      }
      if (
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.ctrl("c")) ||
        data.toLowerCase() === "n"
      ) {
        this.showingConfirmation = false;
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      return;
    }

    // Global navigation and commands
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.cancel();
      return;
    }

    // Tab / Shift+Tab for navigation
    if (matchesKey(data, Key.tab)) {
      if (this.showingNotesScreen) {
        this.saveCurrentEditorText();
        this.showingConfirmation = true;
        this.invalidate();
      } else if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
      } else {
        this.navigateToNotes();
      }
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      if (this.showingNotesScreen) {
        this.navigateTo(this.questions.length - 1);
        this.tui.requestRender();
      } else if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
      }
      return;
    }

    // Scroll long markdown context. Plain arrows work before the user starts an answer;
    // PageUp/PageDown work on question screens and do not interfere with answer editing.
    if (
      !this.showingNotesScreen &&
      ((matchesKey(data, Key.up) && this.editor.getText() === "") || matchesKey(data, Key.pageUp))
    ) {
      if (this.scrollContext(matchesKey(data, Key.pageUp) ? -this.maxContextLines : -1)) {
        this.tui.requestRender();
        return;
      }
    }
    if (
      !this.showingNotesScreen &&
      ((matchesKey(data, Key.down) && this.editor.getText() === "") ||
        matchesKey(data, Key.pageDown))
    ) {
      if (this.scrollContext(matchesKey(data, Key.pageDown) ? this.maxContextLines : 1)) {
        this.tui.requestRender();
        return;
      }
    }

    // Arrow up/down for question navigation when editor is empty and the context
    // cannot scroll further. Editor handles cursor navigation once there is content.
    if (!this.showingNotesScreen && matchesKey(data, Key.up) && this.editor.getText() === "") {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
        return;
      }
    }
    if (!this.showingNotesScreen && matchesKey(data, Key.down) && this.editor.getText() === "") {
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
        return;
      }
    }

    // Handle Enter ourselves (editor's submit is disabled)
    // Plain Enter moves to the next question, then notes, then confirmation.
    // Shift+Enter adds a newline (handled by editor)
    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      this.saveCurrentEditorText();
      if (this.showingNotesScreen) {
        this.showingConfirmation = true;
      } else if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
      } else {
        this.navigateToNotes();
      }
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    // Pass to editor
    this.editor.handleInput(data);
    this.invalidate();
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const boxWidth = Math.max(2, width);
    const contentWidth = Math.max(1, boxWidth - 4); // 2 chars padding on each side

    // Helper to create horizontal lines (dim the whole thing at once)
    const horizontalLine = (count: number) => "─".repeat(Math.max(0, count));

    // Helper to create a box line
    const boxLine = (content: string, leftPad: number = 2): string => {
      const availableWidth = Math.max(0, boxWidth - leftPad - 2);
      const paddedContent = " ".repeat(leftPad) + truncateToWidth(content, availableWidth);
      const contentLen = visibleWidth(paddedContent);
      const rightPad = Math.max(0, boxWidth - contentLen - 2);
      return this.dim("│") + paddedContent + " ".repeat(rightPad) + this.dim("│");
    };

    const emptyBoxLine = (): string => {
      return this.dim("│") + " ".repeat(Math.max(0, boxWidth - 2)) + this.dim("│");
    };

    const padToWidth = (line: string): string => {
      const len = visibleWidth(line);
      return line + " ".repeat(Math.max(0, width - len));
    };

    // Title
    lines.push(padToWidth(this.dim("╭" + horizontalLine(boxWidth - 2) + "╮")));
    const totalSteps = this.questions.length + 1;
    const currentStep = this.showingNotesScreen ? totalSteps : this.currentIndex + 1;
    const titleText = this.showingNotesScreen ? "Additional notes" : "Questions";
    const title = `${this.bold(this.cyan(titleText))} ${this.dim(`(${currentStep}/${totalSteps})`)}`;
    lines.push(padToWidth(boxLine(title)));
    lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));

    // Progress indicator
    const progressParts: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const answered = (this.answers[i]?.trim() || "").length > 0;
      const current = !this.showingNotesScreen && i === this.currentIndex;
      if (current) {
        progressParts.push(this.cyan("●"));
      } else if (answered) {
        progressParts.push(this.green("●"));
      } else {
        progressParts.push(this.dim("○"));
      }
    }
    const hasNotes = this.additionalNotes.trim().length > 0;
    progressParts.push(
      this.showingNotesScreen ? this.cyan("✎") : hasNotes ? this.green("✎") : this.dim("✎"),
    );
    lines.push(padToWidth(boxLine(progressParts.join(" "))));
    lines.push(padToWidth(emptyBoxLine()));

    this.lastContextLineCount = 0;
    this.lastContextViewportLines = 0;
    if (this.showingNotesScreen) {
      const notePromptLines = this.renderMarkdown(
        "Add any optional notes to send with your answers. Leave this blank if there is nothing to add.",
        contentWidth,
      );
      for (const line of notePromptLines) {
        lines.push(padToWidth(boxLine(line)));
      }
    } else {
      // Current question. Render as Markdown so inline code, emphasis, links,
      // lists, and other formatting stay readable.
      const q = this.questions[this.currentIndex];
      const questionLines = this.renderMarkdown(q.question, contentWidth);
      for (const line of questionLines) {
        lines.push(padToWidth(boxLine(line)));
      }

      // Context if present. Render as Markdown so blockquotes, lists, code fences,
      // tables, and syntax highlighting stay rich and readable.
      if (q.context) {
        lines.push(padToWidth(emptyBoxLine()));

        const contextLines = this.renderMarkdown(q.context, contentWidth);
        this.lastContextLineCount = contextLines.length;
        this.lastContextViewportLines = Math.min(this.maxContextLines, contextLines.length);

        const maxScroll = Math.max(0, contextLines.length - this.lastContextViewportLines);
        const scrollOffset = Math.max(
          0,
          Math.min(maxScroll, this.contextScrollOffsets[this.currentIndex] ?? 0),
        );
        this.contextScrollOffsets[this.currentIndex] = scrollOffset;

        if (contextLines.length > this.lastContextViewportLines) {
          const scrollInfo = `${this.dim(
            `(${scrollOffset + 1}-${scrollOffset + this.lastContextViewportLines}/${contextLines.length})`,
          )} ${this.dim("↑/↓ or PgUp/PgDn")}`;
          lines.push(padToWidth(boxLine(truncateToWidth(scrollInfo, contentWidth))));
        }

        const visibleContextLines = contextLines.slice(
          scrollOffset,
          scrollOffset + this.lastContextViewportLines,
        );
        for (const line of visibleContextLines) {
          lines.push(padToWidth(boxLine(line)));
        }
      }
    }

    lines.push(padToWidth(emptyBoxLine()));

    // Render the editor component (multi-line input) with padding
    // Skip the first and last lines (editor's own border lines)
    const editorPrefixText = this.showingNotesScreen ? "Notes: " : "A: ";
    const editorPrefix = this.bold(editorPrefixText);
    const editorWidth = Math.max(1, contentWidth - 4 - visibleWidth(editorPrefixText));
    const editorLines = this.editor.render(editorWidth);
    for (let i = 1; i < editorLines.length - 1; i++) {
      if (i === 1) {
        // First content line gets the input prefix
        lines.push(padToWidth(boxLine(editorPrefix + editorLines[i])));
      } else {
        // Subsequent lines get padding to align with the first line
        lines.push(
          padToWidth(boxLine(" ".repeat(visibleWidth(editorPrefixText)) + editorLines[i])),
        );
      }
    }

    lines.push(padToWidth(emptyBoxLine()));

    // Confirmation dialog or footer with controls
    if (this.showingConfirmation) {
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
      const confirmMsg = `${this.yellow("Submit answers and notes?")} ${this.dim("(Enter/y to confirm, Esc/n to cancel)")}`;
      lines.push(padToWidth(boxLine(truncateToWidth(confirmMsg, contentWidth))));
    } else {
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
      const scrollControls = this.canScrollContext()
        ? ` · ${this.dim("↑/↓ PgUp/PgDn")} scroll`
        : "";
      const nextAction = this.showingNotesScreen
        ? "submit"
        : this.currentIndex === this.questions.length - 1
          ? "notes"
          : "next";
      const prevAction = this.showingNotesScreen ? "back" : "prev";
      const controls = `${this.dim("Tab/Enter")} ${nextAction} · ${this.dim("Shift+Tab")} ${prevAction} · ${this.dim("Shift+Enter")} newline${scrollControls} · ${this.dim("Esc")} cancel`;
      lines.push(padToWidth(boxLine(truncateToWidth(controls, contentWidth))));
    }
    lines.push(padToWidth(this.dim("╰" + horizontalLine(boxWidth - 2) + "╯")));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  const answerHandler = async (ctx: ExtensionContext) => {
    if (!ctx.hasUI) {
      ctx.ui.notify("answer requires interactive mode", "error");
      return;
    }

    if (!ctx.model) {
      ctx.ui.notify("No model selected", "error");
      return;
    }

    // Find the last assistant message on the current branch
    const branch = ctx.sessionManager.getBranch();
    let lastAssistantText: string | undefined;

    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === "message") {
        const msg = entry.message;
        if ("role" in msg && msg.role === "assistant") {
          if (msg.stopReason !== "stop") {
            ctx.ui.notify(`Last assistant message incomplete (${msg.stopReason})`, "error");
            return;
          }
          const textParts = msg.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text);
          if (textParts.length > 0) {
            lastAssistantText = textParts.join("\n");
            break;
          }
        }
      }
    }

    if (!lastAssistantText) {
      ctx.ui.notify("No assistant messages found", "error");
      return;
    }

    let extractionResult = parseNumberedQuestionList(lastAssistantText);

    if (!extractionResult) {
      // Select the best model for extraction (prefer GPT-5.3, then haiku)
      const extractionModel = await selectExtractionModel(ctx.model, ctx.modelRegistry);

      // Run extraction with loader UI
      extractionResult = await ctx.ui.custom<ExtractionResult | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          `Extracting questions using ${extractionModel.id}...`,
        );
        loader.onAbort = () => done(null);

        const doExtract = async () => {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(extractionModel);
          if (auth.ok === false) {
            throw new Error(auth.error);
          }
          const userMessage: UserMessage = {
            role: "user",
            content: [{ type: "text", text: lastAssistantText! }],
            timestamp: Date.now(),
          };

          const response = await complete(
            extractionModel,
            { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
            { apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
          );

          if (response.stopReason === "aborted") {
            return null;
          }

          const responseText = response.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");

          return parseExtractionResult(responseText);
        };

        doExtract()
          .then(done)
          .catch(() => done(null));

        return loader;
      });
    }

    if (extractionResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    if (extractionResult.questions.length === 0) {
      ctx.ui.notify("No questions found in the last message", "info");
      return;
    }

    // Show the Q&A component
    const answersResult = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
      return new QnAComponent(extractionResult.questions, tui, done);
    });

    if (answersResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    // Send the answers directly as a message and trigger a turn
    pi.sendMessage(
      {
        customType: "answers",
        content: "I answered your questions in the following way:\n\n" + answersResult,
        display: true,
      },
      { triggerTurn: true },
    );
  };

  pi.registerCommand("answer", {
    description: "Extract questions from last assistant message into interactive Q&A",
    handler: (_args, ctx) => answerHandler(ctx),
  });

  pi.registerShortcut("ctrl+.", {
    description: "Extract and answer questions",
    handler: answerHandler,
  });
}
