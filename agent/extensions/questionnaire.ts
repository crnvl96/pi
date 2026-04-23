import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  Text,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "typebox";

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionInput {
  id: string;
  label?: string;
  prompt: string;
  options: QuestionOption[];
  allowOther?: boolean;
}

interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
}

export interface Answer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number;
}

export interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}

type RenderOption = QuestionOption & { isOther?: boolean; isRecommended?: boolean };

const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "The value returned when selected" }),
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({
      description:
        "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
    }),
  ),
  prompt: Type.String({ description: "The full question text to display" }),
  options: Type.Array(QuestionOptionSchema, { description: "Available options to choose from" }),
  allowOther: Type.Optional(
    Type.Boolean({ description: "Allow 'Type something' option (default: true)" }),
  ),
});

const QuestionnaireParams = Type.Object({
  questions: Type.Array(QuestionSchema, { description: "Questions to ask the user" }),
});

function normalizeQuestions(input: QuestionInput[]): Question[] {
  return input.map((question, index) => ({
    id: question.id,
    label: question.label || `Q${index + 1}`,
    prompt: question.prompt,
    options: question.options,
    allowOther: question.allowOther !== false,
  }));
}

function errorResult(
  message: string,
  questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
  return {
    content: [{ type: "text", text: message }],
    details: { questions, answers: [], cancelled: true },
  };
}

function pushWrappedLine(lines: string[], width: number, text: string, indent = ""): void {
  const availableWidth = Math.max(1, width - indent.length);
  const wrapped = wrapTextWithAnsi(text, availableWidth);
  if (wrapped.length === 0) {
    lines.push(indent);
    return;
  }
  for (const line of wrapped) {
    lines.push(`${indent}${line}`);
  }
}

function pushLine(lines: string[], width: number, text: string): void {
  lines.push(truncateToWidth(text, Math.max(1, width)));
}

function getQuestionNumber(question: Question, fallbackIndex: number): string {
  const match = question.label.match(/\d+/);
  return match ? match[0] : String(fallbackIndex + 1);
}

export async function runQuestionnaire(
  ctx: ExtensionContext,
  inputQuestions: QuestionInput[],
): Promise<QuestionnaireResult> {
  const questions = normalizeQuestions(inputQuestions);
  if (!ctx.hasUI || questions.length === 0) {
    return { questions, answers: [], cancelled: true };
  }

  const isMulti = questions.length > 1;
  const totalTabs = questions.length + 1;

  return ctx.ui.custom<QuestionnaireResult>((tui, theme, keybindings, done) => {
    let currentTab = 0;
    let optionIndex = 0;
    let inputMode = false;
    let inputQuestionId: string | null = null;
    let cachedWidth: number | undefined;
    let cachedLines: string[] | undefined;
    const answers = new Map<string, Answer>();

    const editorTheme: EditorTheme = {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    };
    const editor = new Editor(tui, editorTheme);

    function refresh(): void {
      cachedWidth = undefined;
      cachedLines = undefined;
      tui.requestRender();
    }

    function submit(cancelled: boolean): void {
      done({ questions, answers: Array.from(answers.values()), cancelled });
    }

    function currentQuestion(): Question | undefined {
      return questions[currentTab];
    }

    function currentOptions(): RenderOption[] {
      const question = currentQuestion();
      if (!question) {
        return [];
      }
      const options: RenderOption[] = question.options.map((option, index) => ({
        ...option,
        isRecommended: index === 0,
      }));
      if (question.allowOther) {
        options.push({ value: "__other__", label: "Type something", isOther: true });
      }
      return options;
    }

    function allAnswered(): boolean {
      return questions.every((question) => answers.has(question.id));
    }

    function advanceAfterAnswer(): void {
      if (!isMulti) {
        submit(false);
        return;
      }
      if (currentTab < questions.length - 1) {
        currentTab += 1;
      } else {
        currentTab = questions.length;
      }
      optionIndex = 0;
      refresh();
    }

    function saveAnswer(
      questionId: string,
      value: string,
      label: string,
      wasCustom: boolean,
      index?: number,
    ): void {
      answers.set(questionId, { id: questionId, value, label, wasCustom, index });
    }

    editor.onSubmit = (value) => {
      if (!inputQuestionId) {
        return;
      }
      const trimmed = value.trim() || "(no response)";
      saveAnswer(inputQuestionId, trimmed, trimmed, true);
      inputMode = false;
      inputQuestionId = null;
      editor.setText("");
      advanceAfterAnswer();
    };

    function handleInput(data: string): void {
      if (inputMode) {
        if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
          inputMode = false;
          inputQuestionId = null;
          editor.setText("");
          refresh();
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }

      const question = currentQuestion();
      const options = currentOptions();

      if (isMulti) {
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
          currentTab = (currentTab + 1) % totalTabs;
          optionIndex = 0;
          refresh();
          return;
        }
        if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
          currentTab = (currentTab - 1 + totalTabs) % totalTabs;
          optionIndex = 0;
          refresh();
          return;
        }
      }

      if (currentTab === questions.length) {
        if (keybindings.matches(data, "tui.select.confirm") && allAnswered()) {
          submit(false);
          return;
        }
        if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
          submit(true);
        }
        return;
      }

      if (keybindings.matches(data, "tui.select.up")) {
        optionIndex = Math.max(0, optionIndex - 1);
        refresh();
        return;
      }
      if (keybindings.matches(data, "tui.select.down")) {
        optionIndex = Math.min(options.length - 1, optionIndex + 1);
        refresh();
        return;
      }

      if (keybindings.matches(data, "tui.select.confirm") && question) {
        const option = options[optionIndex];
        if (!option) {
          return;
        }
        if (option.isOther) {
          inputMode = true;
          inputQuestionId = question.id;
          editor.setText("");
          refresh();
          return;
        }
        saveAnswer(question.id, option.value, option.label, false, optionIndex + 1);
        advanceAfterAnswer();
        return;
      }

      if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
        submit(true);
      }
    }

    function render(width: number): string[] {
      if (cachedLines && cachedWidth === width) {
        return cachedLines;
      }

      const lines: string[] = [];
      const question = currentQuestion();
      const options = currentOptions();
      const border = theme.fg("accent", "-".repeat(Math.max(1, width)));
      const addLine = (text: string) => pushLine(lines, width, text);
      const addWrapped = (text: string, indent = "") => pushWrappedLine(lines, width, text, indent);

      lines.push(border);

      if (isMulti) {
        const tabs: string[] = [];
        for (let i = 0; i < questions.length; i++) {
          const current = questions[i]!;
          const answered = answers.has(current.id);
          const text = ` ${answered ? "[x]" : "[ ]"} ${current.label} `;
          const styled =
            i === currentTab
              ? theme.bg("selectedBg", theme.fg("text", text))
              : theme.fg(answered ? "success" : "muted", text);
          tabs.push(styled);
        }
        const submitText = " Submit ";
        const submitStyled =
          currentTab === questions.length
            ? theme.bg("selectedBg", theme.fg("text", submitText))
            : theme.fg(allAnswered() ? "success" : "dim", submitText);
        addLine(` ${tabs.join(" ")} ${submitStyled}`);
        lines.push("");
      }

      function renderQuestionHeader(current: Question): void {
        const number = getQuestionNumber(current, currentTab);
        addLine(theme.fg("accent", theme.bold(` Question #${number}`)));
        addWrapped(theme.fg("text", ` ${current.prompt}`));
        lines.push("");
      }

      function renderOptions(): void {
        for (let i = 0; i < options.length; i++) {
          const option = options[i]!;
          const selected = i === optionIndex;
          const prefix = selected ? theme.fg("accent", "> ") : "  ";
          let label = `${i + 1}. ${option.label}`;
          if (option.isOther && inputMode) {
            label += " [editing]";
          }
          const styledLabel = selected ? theme.fg("accent", label) : theme.fg("text", label);
          const recommended = option.isRecommended
            ? ` ${theme.fg("success", "[recommended]")}`
            : "";
          addWrapped(`${prefix}${styledLabel}${recommended}`);
          if (option.description) {
            addWrapped(theme.fg("muted", option.description), "     ");
          }
        }
      }

      if (inputMode && question) {
        renderQuestionHeader(question);
        renderOptions();
        lines.push("");
        addLine(theme.fg("muted", " Your answer"));
        for (const line of editor.render(Math.max(1, width - 2))) {
          addLine(` ${line}`);
        }
        lines.push("");
        addLine(theme.fg("dim", " Enter to submit | Esc to cancel"));
      } else if (currentTab === questions.length) {
        addLine(theme.fg("accent", theme.bold(" Ready to submit")));
        lines.push("");
        for (const current of questions) {
          const answer = answers.get(current.id);
          if (!answer) {
            continue;
          }
          const prefix = answer.wasCustom ? "(wrote) " : "";
          addWrapped(
            `${theme.fg("muted", ` ${current.label}: `)}${theme.fg("text", `${prefix}${answer.label}`)}`,
          );
        }
        lines.push("");
        if (allAnswered()) {
          addLine(theme.fg("success", " Press Enter to submit"));
        } else {
          const missing = questions
            .filter((current) => !answers.has(current.id))
            .map((current) => current.label)
            .join(", ");
          addWrapped(theme.fg("warning", ` Unanswered: ${missing}`));
        }
      } else if (question) {
        renderQuestionHeader(question);
        renderOptions();
      }

      lines.push("");
      if (!inputMode) {
        const help = isMulti
          ? " Tab/Left/Right navigate | Up/Down select | Enter confirm | Esc cancel"
          : " Up/Down navigate | Enter select | Esc cancel";
        addLine(theme.fg("dim", help));
      }
      lines.push(border);

      cachedWidth = width;
      cachedLines = lines;
      return lines;
    }

    return {
      render,
      invalidate: () => {
        cachedWidth = undefined;
        cachedLines = undefined;
        editor.invalidate();
      },
      handleInput,
    };
  });
}

export default function questionnaire(pi: ExtensionAPI) {
  pi.registerTool({
    name: "questionnaire",
    label: "Questionnaire",
    description:
      "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.",
    parameters: QuestionnaireParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const questions = normalizeQuestions(params.questions);
      if (!ctx.hasUI) {
        return errorResult("Error: UI not available (running in non-interactive mode)", questions);
      }
      if (questions.length === 0) {
        return errorResult("Error: No questions provided");
      }

      const result = await runQuestionnaire(ctx, params.questions);
      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled the questionnaire" }],
          details: result,
        };
      }

      const answerLines = result.answers.map((answer) => {
        const question = result.questions.find((current) => current.id === answer.id);
        const label = question?.label || answer.id;
        if (answer.wasCustom) {
          return `${label}: user wrote: ${answer.label}`;
        }
        return `${label}: user selected: ${answer.index}. ${answer.label}`;
      });

      return {
        content: [{ type: "text", text: answerLines.join("\n") }],
        details: result,
      };
    },

    renderCall(args, theme, _context) {
      const questions = (args.questions as QuestionInput[]) || [];
      const count = questions.length;
      const labels = questions.map((question) => question.label || question.id).join(", ");
      let text = theme.fg("toolTitle", theme.bold("questionnaire "));
      text += theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`);
      if (labels) {
        text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as QuestionnaireResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }
      const lines = details.answers.map((answer) => {
        if (answer.wasCustom) {
          return `${theme.fg("success", "[x] ")}${theme.fg("accent", answer.id)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`;
        }
        const display = answer.index ? `${answer.index}. ${answer.label}` : answer.label;
        return `${theme.fg("success", "[x] ")}${theme.fg("accent", answer.id)}: ${display}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
