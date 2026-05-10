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
  recommendedAnswer?: string;
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
      "recommendedAnswer": "Optional recommended answer. Preserve the complete markdown answer, including code blocks, bullets, and examples.",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text, but do not omit any part of the question
- If a question has a **Recommended Answer** / **Recommended answer** section, put the full section body in recommendedAnswer exactly enough to preserve all meaning, code blocks, bullets, examples, and snippets
- Include context only when it provides essential information for answering and is not already part of recommendedAnswer
- If no questions are found, return {"questions": []}

Example output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "recommendedAnswer": "PostgreSQL, unless there is an existing operational reason to prefer MySQL.",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?"
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

function splitTopLevelNumberedItems(text: string): string[] {
  const items: string[][] = [];
  let current: string[] | undefined;
  let inFence = false;

  for (const line of text.split(/\r?\n/)) {
    if (!inFence && /^\d+\.\s+.*\*\*\s*Question\s*:?\s*\*\*/i.test(line)) {
      current = [line.replace(/^\d+\.\s+/, "")];
      items.push(current);
    } else if (current) {
      current.push(line);
    }

    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
    }
  }

  return items.map((item) => item.join("\n").trim()).filter((item) => item.length > 0);
}

function parseQuestionWithRecommendation(item: string): ExtractedQuestion | null {
  const questionLabel = /\*\*\s*Question\s*:?\s*\*\*\s*:?\s*/i.exec(item);
  if (!questionLabel) return null;

  const questionStart = questionLabel.index + questionLabel[0].length;
  const afterQuestion = item.slice(questionStart);
  const answerLabel = /\*\*\s*Recommended\s+Answer\s*:?\s*\*\*\s*:?\s*/i.exec(afterQuestion);
  if (!answerLabel) return null;

  const answerStart = questionStart + answerLabel.index + answerLabel[0].length;
  const question = item
    .slice(questionStart, questionStart + answerLabel.index)
    .trim()
    .replace(/\s+/g, " ");
  const recommendedAnswer = item.slice(answerStart).trim();

  if (!question || !recommendedAnswer) return null;
  return { question, recommendedAnswer };
}

function parseGrillMeQuestions(text: string): ExtractionResult | null {
  const questions = splitTopLevelNumberedItems(text)
    .map(parseQuestionWithRecommendation)
    .filter((question): question is ExtractedQuestion => question !== null);

  return questions.length > 0 ? { questions } : null;
}

/**
 * Interactive Q&A component for answering extracted questions
 */
class QnAComponent implements Component {
  private questions: ExtractedQuestion[];
  private answers: string[];
  private currentIndex: number = 0;
  private editor: Editor;
  private tui: TUI;
  private onDone: (result: string | null) => void;
  private showingConfirmation: boolean = false;

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

  private saveCurrentAnswer(): void {
    this.answers[this.currentIndex] = this.editor.getText();
  }

  private navigateTo(index: number): void {
    if (index < 0 || index >= this.questions.length) return;
    this.saveCurrentAnswer();
    this.currentIndex = index;
    this.editor.setText(this.answers[index] || "");
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
      if (q.recommendedAnswer) {
        parts.push(`Recommended Answer: ${q.recommendedAnswer}`);
      }
      if (q.context) {
        parts.push(`> ${q.context}`);
      }
      parts.push(`A: ${a}`);
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
      if (this.currentIndex < this.questions.length - 1) {
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
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
        return;
      }
    }

    // Handle Enter ourselves (editor's submit is disabled)
    // Plain Enter moves to next question or shows confirmation on last question
    // Shift+Enter adds a newline (handled by editor)
    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      this.saveCurrentAnswer();
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
      } else {
        // On last question - show confirmation
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
    const boxWidth = Math.min(width - 4, 120); // Allow wider box
    const contentWidth = boxWidth - 4; // 2 chars padding on each side

    // Helper to create horizontal lines (dim the whole thing at once)
    const horizontalLine = (count: number) => "─".repeat(count);

    // Helper to create a box line
    const boxLine = (content: string, leftPad: number = 2): string => {
      const maxContentWidth = Math.max(0, boxWidth - leftPad - 2);
      const safeContent = truncateToWidth(content, maxContentWidth, "");
      const paddedContent = " ".repeat(leftPad) + safeContent;
      const contentLen = visibleWidth(paddedContent);
      const rightPad = Math.max(0, boxWidth - contentLen - 2);
      return this.dim("│") + paddedContent + " ".repeat(rightPad) + this.dim("│");
    };

    const emptyBoxLine = (): string => {
      return this.dim("│") + " ".repeat(boxWidth - 2) + this.dim("│");
    };

    const padToWidth = (line: string): string => {
      const len = visibleWidth(line);
      return line + " ".repeat(Math.max(0, width - len));
    };

    // Title
    lines.push(padToWidth(this.dim("╭" + horizontalLine(boxWidth - 2) + "╮")));
    const title = `${this.bold(this.cyan("Questions"))} ${this.dim(`(${this.currentIndex + 1}/${this.questions.length})`)}`;
    lines.push(padToWidth(boxLine(title)));
    lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));

    // Progress indicator
    const progressParts: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const answered = (this.answers[i]?.trim() || "").length > 0;
      const current = i === this.currentIndex;
      if (current) {
        progressParts.push(this.cyan("●"));
      } else if (answered) {
        progressParts.push(this.green("●"));
      } else {
        progressParts.push(this.dim("○"));
      }
    }
    lines.push(padToWidth(boxLine(progressParts.join(" "))));
    lines.push(padToWidth(emptyBoxLine()));

    const renderMarkdown = (markdown: string): void => {
      const component = new Markdown(markdown, 0, 0, getMarkdownTheme());
      for (const line of component.render(contentWidth)) {
        lines.push(padToWidth(boxLine(line)));
      }
    };

    // Current question
    const q = this.questions[this.currentIndex];
    lines.push(padToWidth(boxLine(this.bold("Question:"))));
    renderMarkdown(q.question);

    // Recommended answer if present
    if (q.recommendedAnswer) {
      lines.push(padToWidth(emptyBoxLine()));
      lines.push(padToWidth(boxLine(this.bold(this.yellow("Recommended Answer:")))));
      renderMarkdown(q.recommendedAnswer);
    }

    // Context if present
    if (q.context) {
      lines.push(padToWidth(emptyBoxLine()));
      lines.push(padToWidth(boxLine(this.bold("Context:"))));
      const contextText = this.gray(`> ${q.context}`);
      const wrappedContext = wrapTextWithAnsi(contextText, contentWidth - 2);
      for (const line of wrappedContext) {
        lines.push(padToWidth(boxLine(line)));
      }
    }

    lines.push(padToWidth(emptyBoxLine()));

    // Render the editor component (multi-line input) with padding
    // Skip the first and last lines (editor's own border lines)
    const answerPrefix = this.bold("A: ");
    const editorWidth = contentWidth - 4 - 3; // Extra padding + space for "A: "
    const editorLines = this.editor.render(editorWidth);
    for (let i = 1; i < editorLines.length - 1; i++) {
      if (i === 1) {
        // First content line gets the "A: " prefix
        lines.push(padToWidth(boxLine(answerPrefix + editorLines[i])));
      } else {
        // Subsequent lines get padding to align with the first line
        lines.push(padToWidth(boxLine("   " + editorLines[i])));
      }
    }

    lines.push(padToWidth(emptyBoxLine()));

    // Confirmation dialog or footer with controls
    if (this.showingConfirmation) {
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
      const confirmMsg = `${this.yellow("Submit all answers?")} ${this.dim("(Enter/y to confirm, Esc/n to cancel)")}`;
      lines.push(padToWidth(boxLine(truncateToWidth(confirmMsg, contentWidth))));
    } else {
      lines.push(padToWidth(this.dim("├" + horizontalLine(boxWidth - 2) + "┤")));
      const controls = `${this.dim("Tab/Enter")} next · ${this.dim("Shift+Tab")} prev · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
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

    const parsedGrillMeQuestions = parseGrillMeQuestions(lastAssistantText);
    let extractionResult: ExtractionResult | null = parsedGrillMeQuestions;

    // Run extraction with loader UI when the grill-me template was not detected.
    if (!extractionResult) {
      // Select the best model for extraction (prefer GPT-5.3, then haiku)
      const extractionModel = await selectExtractionModel(ctx.model, ctx.modelRegistry);

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
