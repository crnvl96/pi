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
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// Structured output format for question extraction
interface ExtractedQuestion {
  question: string;
  context?: string;
}

interface ExtractionResult {
  questions: ExtractedQuestion[];
}

const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract questions and the rich context that helps answer each question.

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
- Include context only when it helps answer the question
- If the assistant provided a recommended answer, sample answer, example answer, rationale, table, citation, snippet, or code block for a question, include the complete related content in context
- Preserve rich markdown in context exactly enough to render correctly: bullet/numbered lists, blockquotes, fenced code blocks, inline code, tables, links, citations, and quotes
- For numbered questionnaire-style text, associate each "Recommended answer" section with the question immediately before it
- Do not split recommended answers into separate questions
- Do not flatten markdown into one line
- If no questions are found, return {"questions": []}

Input pattern examples:
1. **What is your main goal right now?**
   **Recommended answer:** My main goal is to improve consistency.

2. **How do you prioritize tasks?**
   **Recommended answer:**
   - Urgent and important first
   - High-impact work next

3. **What does success look like?**
   **Recommended answer:**
   \`\`\`text
   Success = clear outcome + measurable result + reasonable timeline
   \`\`\`

For those patterns, extract the question text and put the full recommended answer markdown in context.

Example JSON output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?",
      "context": "**Recommended answer:** Go with TypeScript due to its typing system which improves reliability."
    },
    {
      "question": "Should we implement tests?",
      "context": "**My recommendation:**\n- Yes\n- Mock integrations and SDKs"
    },
    {
      "question": "The API call should be sync or async?"
    }
  ]
}`;

const CODEX_MODEL_ID = "gpt-5.4-mini";
const HAIKU_MODEL_ID = "claude-haiku-4-5";

/**
 * Prefer GPT-5.3 for extraction when available, otherwise fallback to haiku or the current model.
 */
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
  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);

  const fencedMatch = trimmed.match(/^```(?:json)?[ \t]*\n([\s\S]*)\n```$/);
  if (fencedMatch) {
    candidates.push(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const jsonStr of candidates) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && Array.isArray(parsed.questions)) {
        const questions = parsed.questions
          .map((item: unknown): ExtractedQuestion | null => {
            if (!item || typeof item !== "object") return null;
            const candidate = item as { question?: unknown; context?: unknown };
            if (typeof candidate.question !== "string" || candidate.question.trim() === "") {
              return null;
            }
            const question: ExtractedQuestion = { question: candidate.question.trim() };
            if (typeof candidate.context === "string" && candidate.context.trim() !== "") {
              question.context = candidate.context.trim();
            }
            return question;
          })
          .filter((item: ExtractedQuestion | null): item is ExtractedQuestion => item !== null);
        return { questions };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
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

function normalizeQuestionText(text: string): string {
  return text
    .trim()
    .replace(/^#+\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1");
}

/**
 * Deterministically parse numbered questionnaire output and preserve all
 * markdown context below each question until the next numbered question.
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
          questions.push({
            lineIndex: i,
            number,
            question: normalizeQuestionText(numberedMatch[2]),
          });
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
  private notes: string = "";
  private currentIndex: number = 0;
  private editor: Editor;
  private tui: TUI;
  private onDone: (result: string | null) => void;
  private showingConfirmation: boolean = false;
  private bodyScroll: number = 0;

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

  private get totalScreens(): number {
    return this.questions.length + 1;
  }

  private isNotesScreen(): boolean {
    return this.currentIndex === this.questions.length;
  }

  private saveCurrentAnswer(): void {
    if (this.isNotesScreen()) {
      this.notes = this.editor.getText();
      return;
    }

    this.answers[this.currentIndex] = this.editor.getText();
  }

  private navigateTo(index: number): void {
    if (index < 0 || index >= this.totalScreens) return;
    this.saveCurrentAnswer();
    this.currentIndex = index;
    this.bodyScroll = 0;
    this.editor.setText(this.isNotesScreen() ? this.notes : this.answers[index] || "");
    this.invalidate();
  }

  private submit(): void {
    this.saveCurrentAnswer();

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

    const notes = this.notes.trim();
    if (notes.length > 0) {
      parts.push("Notes and observations:");
      parts.push(notes);
    }

    this.onDone(parts.join("\n").trim());
  }

  private cancel(): void {
    this.onDone(null);
  }

  private renderContextMarkdown(context: string, width: number): string[] {
    const markdown = new Markdown(context, 0, 0, getMarkdownTheme());
    return markdown.render(width);
  }

  private scrollBody(delta: number): void {
    this.bodyScroll = Math.max(0, this.bodyScroll + delta);
    this.invalidate();
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

    if (matchesKey(data, Key.pageUp)) {
      this.scrollBody(-3);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollBody(3);
      this.tui.requestRender();
      return;
    }

    // Tab / Shift+Tab for navigation
    if (matchesKey(data, Key.tab)) {
      if (this.currentIndex < this.totalScreens - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
      }
      return;
    }

    // Arrow up/down for question navigation when editor is empty
    // (Editor handles its own cursor navigation when there's content)
    if (matchesKey(data, Key.up) && this.editor.getText() === "") {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
        return;
      }
    }
    if (matchesKey(data, Key.down) && this.editor.getText() === "") {
      if (this.currentIndex < this.totalScreens - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
        return;
      }
    }

    // Handle Enter ourselves (editor's submit is disabled)
    // Plain Enter moves to next screen or shows confirmation on the notes screen
    // Shift+Enter adds a newline (handled by editor)
    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      this.saveCurrentAnswer();
      if (this.currentIndex < this.totalScreens - 1) {
        this.navigateTo(this.currentIndex + 1);
      } else {
        this.showingConfirmation = true;
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
    const maxLines = Math.max(1, Math.floor(this.tui.terminal.rows * 0.5));
    const boxWidth = Math.max(20, width);
    const contentWidth = Math.max(10, boxWidth - 4); // 2 chars padding on each side

    // Helper to create horizontal lines (dim the whole thing at once)
    const horizontalLine = (count: number) => "─".repeat(Math.max(0, count));

    // Helper to create a box line
    const boxLine = (content: string, leftPad: number = 2): string => {
      const maxContentWidth = Math.max(0, boxWidth - leftPad - 2);
      const clippedContent = truncateToWidth(content, maxContentWidth, "");
      const paddedContent = " ".repeat(leftPad) + clippedContent;
      const contentLen = visibleWidth(paddedContent);
      const rightPad = Math.max(0, boxWidth - contentLen - 2);
      return this.dim("│") + paddedContent + " ".repeat(rightPad) + this.dim("│");
    };

    const emptyBoxLine = (): string => {
      return this.dim("│") + " ".repeat(Math.max(0, boxWidth - 2)) + this.dim("│");
    };

    const pushLine = (line: string): void => {
      lines.push(truncateToWidth(line, width, ""));
    };

    // Title
    pushLine(this.dim("╭" + horizontalLine(boxWidth - 2) + "╮"));
    const titleLabel = this.isNotesScreen() ? "Notes & observations" : "Questions";
    const title = `${this.bold(this.cyan(titleLabel))} ${this.dim(`(${this.currentIndex + 1}/${this.totalScreens})`)}`;
    pushLine(boxLine(title));
    pushLine(this.dim("├" + horizontalLine(boxWidth - 2) + "┤"));

    // Progress indicator
    const progressParts: string[] = [];
    for (let i = 0; i < this.totalScreens; i++) {
      const answered = i === this.questions.length
        ? this.notes.trim().length > 0
        : (this.answers[i]?.trim() || "").length > 0;
      const current = i === this.currentIndex;
      if (current) {
        progressParts.push(this.cyan("●"));
      } else if (answered) {
        progressParts.push(this.green("●"));
      } else {
        progressParts.push(this.dim("○"));
      }
    }
    pushLine(boxLine(progressParts.join(" ")));
    pushLine(emptyBoxLine());

    const bodyLines: string[] = [];
    if (this.isNotesScreen()) {
      bodyLines.push(this.bold("Optional notes and observations"));
      bodyLines.push("");
      bodyLines.push(
        "Add any extra notes to send with the answers. Leave this blank to send only the answers.",
      );
    } else {
      const q = this.questions[this.currentIndex];
      const questionText = `${this.bold("Q:")} ${q.question}`;
      bodyLines.push(...wrapTextWithAnsi(questionText, contentWidth));

      if (q.context) {
        bodyLines.push("");
        bodyLines.push(this.gray("Context / recommended answer:"));
        bodyLines.push(...this.renderContextMarkdown(q.context, contentWidth));
      }
    }

    // Render the editor component (multi-line input) with padding.
    // Skip the first and last lines (editor's own border lines).
    const answerPrefix = this.isNotesScreen() ? this.bold("N: ") : this.bold("A: ");
    const editorWidth = Math.max(10, contentWidth - 7); // Extra padding + space for "A: " / "N: "
    const renderedEditorLines = this.editor.render(editorWidth);
    const editorBoxLines: string[] = [];
    editorBoxLines.push(emptyBoxLine());
    for (let i = 1; i < renderedEditorLines.length - 1; i++) {
      if (i === 1) {
        editorBoxLines.push(boxLine(answerPrefix + renderedEditorLines[i]));
      } else {
        editorBoxLines.push(boxLine("   " + renderedEditorLines[i]));
      }
    }
    editorBoxLines.push(emptyBoxLine());

    const footerLines: string[] = [];
    footerLines.push(this.dim("├" + horizontalLine(boxWidth - 2) + "┤"));
    if (this.showingConfirmation) {
      const confirmMsg = `${this.yellow("Submit all answers?")} ${this.dim("(Enter/y to confirm, Esc/n to cancel)")}`;
      footerLines.push(boxLine(confirmMsg));
    } else {
      const controls = `${this.dim("Tab/Enter")} next · ${this.dim("Shift+Tab")} prev · ${this.dim("PgUp/PgDn")} scroll context · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
      footerLines.push(boxLine(controls));
    }
    footerLines.push(this.dim("╰" + horizontalLine(boxWidth - 2) + "╯"));

    const availableBodyLines = Math.max(
      1,
      maxLines - lines.length - editorBoxLines.length - footerLines.length,
    );
    const maxBodyScroll = Math.max(0, bodyLines.length - availableBodyLines);
    this.bodyScroll = Math.min(this.bodyScroll, maxBodyScroll);
    const visibleBodyLines = bodyLines.slice(
      this.bodyScroll,
      this.bodyScroll + availableBodyLines,
    );
    if (bodyLines.length > availableBodyLines && visibleBodyLines.length > 0) {
      if (this.bodyScroll > 0) {
        visibleBodyLines[0] = this.dim(`↑ ${this.bodyScroll} more line(s)`);
      }
      if (this.bodyScroll < maxBodyScroll) {
        const remaining = maxBodyScroll - this.bodyScroll;
        visibleBodyLines[visibleBodyLines.length - 1] = this.dim(
          `↓ ${remaining} more line(s) · PgDn to scroll`,
        );
      }
    }

    for (const line of visibleBodyLines) {
      pushLine(boxLine(line));
    }
    for (const line of editorBoxLines) {
      pushLine(line);
    }
    for (const line of footerLines) {
      pushLine(line);
    }

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
      extractionResult = await ctx.ui.custom<ExtractionResult | null>(
        (tui, theme, _kb, done) => {
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
        },
      );
    }

    if (extractionResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    if (extractionResult.questions.length === 0) {
      ctx.ui.notify("No questions found in the last message", "info");
      return;
    }

    // Show the Q&A component at full available width and half available height.
    const answersResult = await ctx.ui.custom<string | null>(
      (tui, _theme, _kb, done) => {
        return new QnAComponent(extractionResult.questions, tui, done);
      },
      {
        overlay: true,
        overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "50%", margin: 0 },
      },
    );

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
