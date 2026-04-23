import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

export interface StructuredQuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface StructuredQuestion {
  number: number;
  prompt: string;
  options: StructuredQuestionOption[];
  allowOther?: boolean;
}

export interface StructuredOutputDetails {
  headline: string;
  summary: string;
  actionItems: string[];
  question?: StructuredQuestion;
}

export function isStructuredQuestionDetails(
  details: StructuredOutputDetails | null | undefined,
): details is StructuredOutputDetails & { question: StructuredQuestion } {
  return (
    details !== undefined &&
    details !== null &&
    details.question !== undefined &&
    Number.isFinite(details.question.number) &&
    typeof details.question.prompt === "string" &&
    Array.isArray(details.question.options)
  );
}

const structuredOutputTool = defineTool({
  name: "structured_output",
  label: "Structured Output",
  description:
    "Return a final structured answer, or end the turn with a structured plan-mode question.",
  promptSnippet: "Emit a final structured answer as a terminating tool result",
  promptGuidelines: [
    "Use structured_output as your final action when the user asks for structured output, JSON-like output, or a machine-readable summary.",
    "In plan mode, use structured_output as your final action when you need to ask one structured multiple-choice question.",
    "After calling structured_output, do not emit another assistant response in the same turn.",
  ],
  parameters: Type.Object({
    headline: Type.String({ description: "Short title for the result" }),
    summary: Type.String({ description: "One-paragraph summary" }),
    actionItems: Type.Array(Type.String(), { description: "Concrete next steps or key bullets" }),
    question: Type.Optional(
      Type.Object({
        number: Type.Number({ description: "Question number in the current interview" }),
        prompt: Type.String({ description: "The question being asked" }),
        options: Type.Array(
          Type.Object({
            value: Type.String({ description: "Stable value for this option" }),
            label: Type.String({ description: "Display label for this option" }),
            description: Type.Optional(
              Type.String({ description: "Optional explanatory text for this option" }),
            ),
          }),
          { description: "Available answer options in order, with the recommended option first" },
        ),
        allowOther: Type.Optional(
          Type.Boolean({
            description: "Whether the questionnaire should also offer 'Type something'",
          }),
        ),
      }),
    ),
  }),

  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Saved structured output: ${params.headline}` }],
      details: {
        headline: params.headline,
        summary: params.summary,
        actionItems: params.actionItems,
        question: params.question,
      } satisfies StructuredOutputDetails,
      terminate: true,
    };
  },

  renderResult(result, _options, theme) {
    const details = result.details as StructuredOutputDetails | undefined;
    if (!details) {
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "", 0, 0);
    }

    if (isStructuredQuestionDetails(details)) {
      const lines: string[] = [];
      lines.push("<question>");
      lines.push(`Question #${details.question.number}`);
      lines.push("");
      lines.push(details.question.prompt);
      lines.push("");
      for (let i = 0; i < details.question.options.length; i++) {
        const option = details.question.options[i]!;
        lines.push(`${i + 1}. ${option.label}`);
        if (option.description) {
          lines.push(`   ${option.description}`);
        }
      }
      if (details.question.allowOther !== false) {
        lines.push(`${details.question.options.length + 1}. Type something`);
      }
      lines.push("</question>");
      return new Text(lines.join("\n"), 0, 0);
    }

    const lines = [
      theme.fg("toolTitle", theme.bold(details.headline)),
      theme.fg("text", details.summary),
      "",
      ...details.actionItems.map((item, index) => theme.fg("muted", `${index + 1}. ${item}`)),
    ];
    return new Text(lines.join("\n"), 0, 0);
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(structuredOutputTool);
}
