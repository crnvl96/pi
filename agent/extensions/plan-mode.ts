import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { runQuestionnaire, type Answer, type QuestionInput } from "./questionnaire.js";
import { isStructuredQuestionDetails, type StructuredOutputDetails } from "./structured-output.js";

const PLAN_MODE_TOOLS = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "questionnaire",
  "structured_output",
  "perplexity_web_search",
  "todo",
];

const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
  /^\s*git\s+ls-/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
  /^\s*yarn\s+(list|info|why|audit)/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*curl\s/i,
  /^\s*wget\s+-O\s*-/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*bat\b/,
  /^\s*eza\b/,
];

const PRD_HEADINGS = [
  "## Problem Statement",
  "## Solution",
  "## User Stories",
  "## Implementation Decisions",
  "## Testing Decisions",
  "## Out of Scope",
];

interface PlanModeState {
  enabled: boolean;
  brief?: string;
  prd?: string;
  normalModeTools?: string[];
}

function isSafeCommand(command: string): boolean {
  const isDestructive = DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
  const isSafe = SAFE_PATTERNS.some((pattern) => pattern.test(command));
  return !isDestructive && isSafe;
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function getLastAssistantText(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (!isAssistantMessage(message)) {
      continue;
    }

    const text = getTextContent(message);
    if (text.trim()) {
      return text;
    }
  }
  return undefined;
}

function extractPrd(text: string): string | undefined {
  const start = text.indexOf("## Problem Statement");
  if (start === -1) {
    return undefined;
  }

  const candidate = text.slice(start).trim();
  return PRD_HEADINGS.every((heading) => candidate.includes(heading)) ? candidate : undefined;
}

function slugifyFilePart(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "prd";
}

function ensureMarkdownExtension(filePath: string): string {
  const extension = extname(filePath);
  if (!extension) {
    return `${filePath}.md`;
  }
  if (extension.toLowerCase() === ".md") {
    return filePath;
  }
  return `${filePath.slice(0, -extension.length)}.md`;
}

function extractProblemStatementTitle(prd: string | undefined): string | undefined {
  if (!prd) {
    return undefined;
  }

  const match = prd.match(/## Problem Statement\s+([\s\S]*?)(?:\n## |$)/);
  if (!match) {
    return undefined;
  }

  const firstLine = match[1]
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  return firstLine.replace(/^-\s*/, "").trim();
}

function formatQuestionAnswer(
  details: StructuredOutputDetails & { question: NonNullable<StructuredOutputDetails["question"]> },
  answer: Answer,
): string {
  const lines = [
    `Plan mode answer to Question #${details.question.number}`,
    `Question: ${details.question.prompt}`,
  ];

  if (answer.wasCustom) {
    lines.push(`Custom answer: ${answer.label}`);
  } else {
    lines.push(`Selected option: ${answer.index}. ${answer.label}`);
    lines.push(`Selected value: ${answer.value}`);
  }

  return lines.join("\n");
}

function buildPlanQuestion(
  details: StructuredOutputDetails & { question: NonNullable<StructuredOutputDetails["question"]> },
): QuestionInput {
  return {
    id: `plan-question-${details.question.number}`,
    label: `Q${details.question.number}`,
    prompt: details.question.prompt,
    options: details.question.options,
    allowOther: details.question.allowOther !== false,
  };
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let normalModeTools: string[] = [];
  let planBrief: string | undefined;
  let currentPrd: string | undefined;
  let pendingQuestion:
    | (StructuredOutputDetails & {
        question: NonNullable<StructuredOutputDetails["question"]>;
      })
    | undefined;

  function persistState(): void {
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      brief: planBrief,
      prd: currentPrd,
      normalModeTools,
    } satisfies PlanModeState);
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      return;
    }

    if (planModeEnabled) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
    }
  }

  function resetPlanArtifacts(): void {
    planBrief = undefined;
    currentPrd = undefined;
    pendingQuestion = undefined;
  }

  function availableTools(names: string[]): string[] {
    const toolNames = new Set(pi.getAllTools().map((tool) => tool.name));
    return names.filter((name) => toolNames.has(name));
  }

  function restoreNormalTools(): void {
    if (normalModeTools.length > 0) {
      pi.setActiveTools(normalModeTools);
    }
  }

  function enablePlanMode(
    ctx: ExtensionContext,
    options?: { announce?: boolean; keepState?: boolean },
  ): void {
    if (!planModeEnabled) {
      normalModeTools = pi.getActiveTools();
    }

    planModeEnabled = true;
    if (!options?.keepState) {
      resetPlanArtifacts();
    }

    pi.setActiveTools(availableTools(PLAN_MODE_TOOLS));
    updateStatus(ctx);
    persistState();

    if (options?.announce !== false) {
      ctx.ui.notify(
        "Plan mode enabled. Send a scoped brief for the change you want to plan.",
        "info",
      );
    }
  }

  function disablePlanMode(
    ctx: ExtensionContext,
    options?: { announce?: boolean; clearState?: boolean },
  ): void {
    planModeEnabled = false;
    pendingQuestion = undefined;
    restoreNormalTools();

    if (options?.clearState !== false) {
      resetPlanArtifacts();
    }

    updateStatus(ctx);
    persistState();

    if (options?.announce !== false) {
      ctx.ui.notify("Plan mode disabled.", "info");
    }
  }

  function getPrdFileName(prd: string): string {
    const title =
      extractProblemStatementTitle(prd) || planBrief || pi.getSessionName() || "plan mode prd";
    const slug = slugifyFilePart(title);
    return slug === "prd" || slug.endsWith("-prd") ? `${slug}.md` : `${slug}-prd.md`;
  }

  async function savePrdAsFile(ctx: ExtensionContext, prd: string): Promise<string | undefined> {
    const suggestedPath = join(ctx.cwd, getPrdFileName(prd));
    const inputPath = await ctx.ui.input("Save PRD file path:", suggestedPath);
    if (!inputPath?.trim()) {
      return undefined;
    }

    const rawPath = inputPath.trim();
    let targetPath = resolve(ctx.cwd, rawPath);

    if (rawPath.endsWith("/") || rawPath.endsWith("\\")) {
      targetPath = join(targetPath, getPrdFileName(prd));
    } else {
      try {
        const info = await stat(targetPath);
        if (info.isDirectory()) {
          targetPath = join(targetPath, getPrdFileName(prd));
        }
      } catch {
        // Treat the input as a file path when it does not exist yet.
      }
    }

    targetPath = ensureMarkdownExtension(targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${prd.trim()}\n`, "utf8");
    return targetPath;
  }

  function buildImplementationPrompt(prd: string): string {
    const lines = [
      "Implement the approved PRD using test-first development.",
      "Load and follow the tdd skill before writing code.",
      "The user has already approved implementing this PRD.",
      "If you still need clarification about interfaces or test priorities, ask concise follow-up questions first.",
    ];

    lines.push("", "<prd>", prd, "</prd>");
    return lines.join("\n");
  }

  async function askForNextStep(ctx: ExtensionContext): Promise<string | undefined> {
    const result = await runQuestionnaire(ctx, [
      {
        id: "plan-next-step",
        label: "Next",
        prompt: "The PRD is ready. What do you want to do next?",
        options: [
          {
            value: "implement",
            label: "Exit plan mode and implement the PRD",
            description: "Move straight into implementation.",
          },
          {
            value: "save-prd",
            label: "Save the PRD as a markdown file",
            description: "Pick a path and save the PRD with a meaningful file name.",
          },
          {
            value: "refine",
            label: "Refine the plan",
            description: "Add new instructions or clarify the plan before finishing it.",
          },
          {
            value: "exit",
            label: "Exit plan mode",
            description: "Leave the plan as-is and stop planning.",
          },
        ],
        allowOther: false,
      },
    ]);

    return result.cancelled ? undefined : result.answers[0]?.value;
  }

  async function handleNextStep(choice: string | undefined, ctx: ExtensionContext): Promise<void> {
    if (!choice) {
      ctx.ui.notify("Plan mode is still active.", "info");
      return;
    }

    if (choice === "refine") {
      currentPrd = undefined;
      persistState();

      const refinement = await ctx.ui.editor("Refine the plan:", "");
      if (refinement?.trim()) {
        pi.sendUserMessage(refinement.trim());
      }
      return;
    }

    if (choice === "exit") {
      disablePlanMode(ctx, { announce: true, clearState: true });
      return;
    }

    if (!currentPrd) {
      ctx.ui.notify("No PRD is available yet.", "error");
      return;
    }

    if (choice === "save-prd") {
      try {
        const savedPath = await savePrdAsFile(ctx, currentPrd);
        if (savedPath) {
          ctx.ui.notify(`Saved PRD to ${savedPath}`, "info");
        } else {
          ctx.ui.notify("PRD save cancelled. Plan mode is still active.", "info");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to save PRD: ${message}`, "error");
      }

      const nextChoice = await askForNextStep(ctx);
      await handleNextStep(nextChoice, ctx);
      return;
    }

    if (choice === "implement") {
      const prd = currentPrd;
      disablePlanMode(ctx, { announce: true, clearState: true });
      pi.sendUserMessage(buildImplementationPrompt(prd));
    }
  }

  pi.registerCommand("plan-mode", {
    description: "Enter or exit the structured planning workflow",
    handler: async (_args, ctx) => {
      if (planModeEnabled) {
        disablePlanMode(ctx, { announce: true, clearState: true });
        return;
      }
      enablePlanMode(ctx, { announce: true, keepState: false });
    },
  });

  pi.on("input", async (event) => {
    if (!planModeEnabled || event.source === "extension") {
      return { action: "continue" as const };
    }

    const text = event.text.trim();
    if (!text || text.startsWith("/")) {
      return { action: "continue" as const };
    }

    if (!planBrief) {
      planBrief = text;
      persistState();
    }

    return { action: "continue" as const };
  });

  pi.on("tool_call", async (event) => {
    if (!planModeEnabled || event.toolName !== "bash") {
      return;
    }

    const command = String(event.input.command || "");
    if (!isSafeCommand(command)) {
      return {
        block: true,
        reason:
          `Plan mode: command blocked (not allowlisted). Disable plan mode before running it.\n` +
          `Command: ${command}`,
      };
    }
  });

  pi.on("tool_result", async (event) => {
    if (!planModeEnabled || event.toolName !== "structured_output" || event.isError) {
      return;
    }

    const details = event.details as StructuredOutputDetails | undefined;
    if (isStructuredQuestionDetails(details)) {
      pendingQuestion = details;
    }
  });

  pi.on("context", async (event) => {
    if (planModeEnabled) {
      return;
    }

    return {
      messages: event.messages.filter((message) => {
        const candidate = message as AgentMessage & { customType?: string };
        return candidate.customType !== "plan-mode-context";
      }),
    };
  });

  pi.on("before_agent_start", async () => {
    if (!planModeEnabled) {
      return;
    }

    return {
      message: {
        customType: "plan-mode-context",
        content: `[PLAN MODE ACTIVE]
You are in a structured planning workflow.

Core rules:
- Stay in read-only planning mode. Do not edit files or implement changes.
- Use the available skill named grill-me to interview the user.
- Use perplexity_web_search when current external information is needed.
- If the user asks you to add something to the todo list, use the todo tool and then continue the planning flow.

Question flow:
- When you need user input, end the turn by calling structured_output.
- Fill headline with "Question #N".
- Fill summary with the exact question text.
- Fill actionItems with the option labels in order.
- Fill question.number, question.prompt, and question.options as structured data.
- Put the recommended option first.
- Do not include a "Type something" option in question.options; set question.allowOther to true instead.
- Do not ask the same question again in assistant text after calling structured_output.

Planning completion:
- Once shared understanding is good enough, use the available skill named to-prd and write the PRD as a normal assistant message using that skill's template.
- After writing the PRD, stop. The extension will ask the user what to do next.
`,
        display: false,
      },
    };
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!planModeEnabled || !ctx.hasUI) {
      pendingQuestion = undefined;
      return;
    }

    if (pendingQuestion) {
      const questionDetails = pendingQuestion;
      pendingQuestion = undefined;

      const result = await runQuestionnaire(ctx, [buildPlanQuestion(questionDetails)]);
      if (result.cancelled) {
        ctx.ui.notify("Question cancelled. Plan mode is still active.", "info");
        return;
      }

      const answer = result.answers[0];
      if (!answer) {
        ctx.ui.notify("No answer was captured.", "warning");
        return;
      }

      pi.sendUserMessage(formatQuestionAnswer(questionDetails, answer));
      return;
    }

    const assistantText = getLastAssistantText(event.messages);
    if (!assistantText) {
      return;
    }

    const prd = extractPrd(assistantText);
    if (!prd || prd === currentPrd) {
      return;
    }

    currentPrd = prd;
    persistState();

    const choice = await askForNextStep(ctx);
    await handleNextStep(choice, ctx);
  });

  pi.on("session_start", async (_event, ctx) => {
    normalModeTools = pi.getActiveTools();

    const stateEntry = ctx.sessionManager
      .getEntries()
      .filter(
        (entry: { type: string; customType?: string }) =>
          entry.type === "custom" && entry.customType === "plan-mode",
      )
      .pop() as { data?: PlanModeState } | undefined;

    if (stateEntry?.data) {
      planModeEnabled = stateEntry.data.enabled;
      planBrief = stateEntry.data.brief;
      currentPrd = stateEntry.data.prd;
      normalModeTools = stateEntry.data.normalModeTools?.length
        ? stateEntry.data.normalModeTools
        : normalModeTools;
    }

    if (planModeEnabled) {
      pi.setActiveTools(availableTools(PLAN_MODE_TOOLS));
    }

    updateStatus(ctx);
  });
}
