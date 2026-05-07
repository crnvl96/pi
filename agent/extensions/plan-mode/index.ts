import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  extractPlanItems,
  formatPlanItems,
  isSafeCommand,
  markCompletedSteps,
  type PlanItem,
} from "./utils.js";

const PLAN_STATE_TYPE = "plan-mode-state";
const PLAN_ANCHOR_TYPE = "plan-mode-anchor";

const READ_ONLY_TOOL_ALLOWLIST = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "question",
  "questionnaire",
  "perplexity-web-search",
];

type PlanModeState = {
  planModeEnabled?: boolean;
  executionMode?: boolean;
  planItems?: PlanItem[];
  planOriginId?: string;
  previousActiveTools?: string[];
};

type AssistantLike = {
  role: "assistant";
  content: unknown[];
};

type SessionEntryLike = {
  type: string;
  id?: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
};

const PLAN_MODE_SYSTEM_PROMPT = `# Plan Mode Active

You are in plan mode: a read-only collaboration mode for gathering context and producing an execution-ready plan.

Workflow:
1. Understand the user's goal and constraints.
2. Inspect the codebase and relevant docs using read-only tools only.
3. Ask concise clarifying questions when requirements are ambiguous.
4. Refine the approach with the user until they are satisfied.
5. Do not implement, edit, write, install, commit, or otherwise mutate the workspace while plan mode is active.
6. Do not execute the plan until the user explicitly triggers /execute-plan.

Tool restrictions while planning:
- Prefer read, grep, find, ls, and safe read-only bash commands for local context.
- Use available web/search tools for current external context when useful.
- Bash must be inspection-only. Do not run commands that create, delete, move, write, install, checkout, reset, or start/stop services.

When a concrete plan is ready, present it under an exact "Plan:" heading as a numbered list:

Plan:
1. First concrete implementation step
2. Second concrete implementation step

Also include assumptions, open questions, success criteria, and verification when relevant. Keep the numbered Plan steps executable and specific.`;

const PLAN_EXECUTION_SYSTEM_PROMPT = `# Executing Approved Plan

The user has approved plan execution.

Rules:
1. Execute the plan in order unless a later discovery makes that unsafe or incorrect.
2. If the plan needs a material change, stop and ask before changing direction.
3. After completing step N, include [DONE:N] in an assistant response so plan-mode can track progress.
4. Run relevant verification for the changed code when practical.
5. End with a concise summary of changed files, verification results, and any deferred work.`;

const PLAN_BRANCH_SUMMARY_PROMPT = `We are leaving a plan-execution branch and returning to the planning branch.
Create a structured handoff that preserves exactly what happened during execution.

Required sections:

## Original Goal
- What the user wanted to accomplish.

## Plan Executed
- Numbered plan steps and whether each was completed, changed, skipped, or blocked.

## Changes Made
- Files changed and the important code/config behavior changed in each.

## Verification
- Commands/checks run and their results.
- Anything not verified and why.

## Decisions & Deviations
- Decisions made during implementation.
- Any deviations from the approved plan and why.

## Remaining Work
- Follow-up tasks, risks, or open questions.

Preserve exact file paths, command names, error messages, and user constraints where available.`;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAssistantMessage(message: unknown): message is AssistantLike {
  return isObject(message) && message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantLike): string {
  return message.content
    .map((block) => {
      if (!isObject(block)) return "";
      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizePlanItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return [];
  const items: PlanItem[] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    items.push({
      step: items.length + 1,
      text,
      completed: item.completed === true,
    });
  }
  return items;
}

function samePlan(a: PlanItem[], b: PlanItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.text === b[index]?.text);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function buildExecutionPrompt(items: PlanItem[], newBranch: boolean): string {
  const branchNote = newBranch
    ? "This execution is being performed on a separate session branch."
    : "This execution is being performed on the current session branch.";

  if (items.length === 0) {
    return `${branchNote}\n\nExecute the plan we refined in plan mode. Follow the approved intent, run relevant verification, and summarize the result.`;
  }

  return `${branchNote}\n\nExecute this approved plan:\n\nPlan:\n${formatPlanItems(items)}\n\nFollow the steps in order. After completing step N, include [DONE:N] in your response.`;
}

function readPlanState(ctx: ExtensionContext): PlanModeState | undefined {
  let state: PlanModeState | undefined;
  for (const entry of ctx.sessionManager.getBranch() as SessionEntryLike[]) {
    if (entry.type === "custom" && entry.customType === PLAN_STATE_TYPE && isObject(entry.data)) {
      const data = entry.data;
      state = {
        planModeEnabled: data.planModeEnabled === true,
        executionMode: data.executionMode === true,
        planItems: normalizePlanItems(data.planItems),
        planOriginId: typeof data.planOriginId === "string" ? data.planOriginId : undefined,
        previousActiveTools: Array.isArray(data.previousActiveTools)
          ? data.previousActiveTools.filter((tool): tool is string => typeof tool === "string")
          : undefined,
      };
    }
  }
  return state;
}

function findLatestPlanItems(ctx: ExtensionContext): PlanItem[] {
  const branch = ctx.sessionManager.getBranch() as SessionEntryLike[];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type !== "message" || !isAssistantMessage(entry.message)) continue;
    const extracted = extractPlanItems(getTextContent(entry.message));
    if (extracted.length > 0) return extracted;
  }
  return [];
}

function findLastAssistant(messages: unknown[]): AssistantLike | undefined {
  return [...messages].reverse().find(isAssistantMessage);
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let executionMode = false;
  let planItems: PlanItem[] = [];
  let planOriginId: string | undefined;
  let previousActiveTools: string[] | undefined;

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only planning)",
    type: "boolean",
    default: false,
  });

  function availableToolNames(): Set<string> {
    return new Set(pi.getAllTools().map((tool) => tool.name));
  }

  function getPlanToolNames(): string[] {
    const available = availableToolNames();
    return READ_ONLY_TOOL_ALLOWLIST.filter((name) => available.has(name));
  }

  function setPlanTools(): void {
    const tools = getPlanToolNames();
    if (tools.length > 0) pi.setActiveTools(tools);
  }

  function restoreTools(options: { forget: boolean }): void {
    const available = availableToolNames();
    const restore = (previousActiveTools ?? []).filter((name) => available.has(name));
    if (restore.length > 0) {
      pi.setActiveTools(restore);
    } else if (!options.forget) {
      pi.setActiveTools([...available]);
    }
    if (options.forget) previousActiveTools = undefined;
  }

  function persistState(): void {
    pi.appendEntry(PLAN_STATE_TYPE, {
      planModeEnabled,
      executionMode,
      planItems,
      planOriginId,
      previousActiveTools,
    } satisfies PlanModeState);
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    if (planModeEnabled) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
      const lines = [ctx.ui.theme.fg("warning", "Plan mode active (read-only).")];
      if (planItems.length > 0) {
        lines.push(ctx.ui.theme.fg("muted", `Captured plan: ${planItems.length} step(s). Run /execute-plan when ready.`));
        for (const item of planItems.slice(0, 8)) {
          lines.push(`${ctx.ui.theme.fg("muted", `${item.step}.`)} ${truncate(item.text, 100)}`);
        }
        if (planItems.length > 8) lines.push(ctx.ui.theme.fg("dim", `... and ${planItems.length - 8} more`));
      } else {
        lines.push(ctx.ui.theme.fg("muted", "Ask the agent to produce a numbered Plan: section."));
      }
      ctx.ui.setWidget("plan-mode", lines);
      return;
    }

    if (executionMode && planItems.length > 0) {
      const completed = planItems.filter((item) => item.completed).length;
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${planItems.length}`));
      const lines = planItems.map((item) => {
        if (item.completed) {
          return `${ctx.ui.theme.fg("success", "☑")} ${ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))}`;
        }
        return `${ctx.ui.theme.fg("muted", "☐")} ${item.text}`;
      });
      if (planOriginId) lines.push(ctx.ui.theme.fg("dim", "When done, run /end-plan to return."));
      ctx.ui.setWidget("plan-mode", lines);
      return;
    }

    if (planOriginId) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", "📋 branch"));
      ctx.ui.setWidget("plan-mode", [
        ctx.ui.theme.fg("accent", "Plan execution branch active."),
        ctx.ui.theme.fg("muted", "Run /end-plan to go back, optionally with a summary."),
      ]);
      return;
    }

    ctx.ui.setStatus("plan-mode", undefined);
    ctx.ui.setWidget("plan-mode", undefined);
  }

  function applyState(ctx: ExtensionContext, options: { allowPlanFlag: boolean }): void {
    const state = readPlanState(ctx);

    planModeEnabled = state?.planModeEnabled ?? false;
    executionMode = state?.executionMode ?? false;
    planItems = state?.planItems ?? [];
    planOriginId = state?.planOriginId;
    previousActiveTools = state?.previousActiveTools;

    if (!state && options.allowPlanFlag && pi.getFlag("plan") === true) {
      previousActiveTools = pi.getActiveTools();
      planModeEnabled = true;
      persistState();
    }

    if (planModeEnabled) {
      setPlanTools();
    } else if (executionMode || planOriginId) {
      restoreTools({ forget: false });
    } else if (previousActiveTools) {
      restoreTools({ forget: true });
    }

    updateStatus(ctx);
  }

  function enterPlanMode(ctx: ExtensionContext): void {
    if (!planModeEnabled) previousActiveTools = pi.getActiveTools();
    planModeEnabled = true;
    executionMode = false;
    planOriginId = undefined;
    planItems = [];
    setPlanTools();
    persistState();
    updateStatus(ctx);
    ctx.ui.notify("Plan mode enabled. Planning is read-only; run /execute-plan when ready.", "info");
  }

  function exitPlanMode(ctx: ExtensionContext): void {
    planModeEnabled = false;
    executionMode = false;
    planOriginId = undefined;
    planItems = [];
    restoreTools({ forget: true });
    persistState();
    updateStatus(ctx);
    ctx.ui.notify("Plan mode disabled. Tools restored.", "info");
  }

  async function ensureOrigin(ctx: ExtensionCommandContext): Promise<string | undefined> {
    let originId = ctx.sessionManager.getLeafId() ?? undefined;
    if (!originId) {
      pi.appendEntry(PLAN_ANCHOR_TYPE, { createdAt: new Date().toISOString() });
      originId = ctx.sessionManager.getLeafId() ?? undefined;
    }
    if (!originId) ctx.ui.notify("Failed to determine plan branch origin.", "error");
    return originId;
  }

  async function startExecution(ctx: ExtensionCommandContext, useNewBranch: boolean): Promise<void> {
    if (!previousActiveTools && !planModeEnabled) previousActiveTools = pi.getActiveTools();

    planModeEnabled = false;
    executionMode = planItems.length > 0;
    planOriginId = useNewBranch ? await ensureOrigin(ctx) : undefined;
    if (useNewBranch && !planOriginId) return;

    restoreTools({ forget: false });
    persistState();
    updateStatus(ctx);

    ctx.ui.notify(useNewBranch ? "Executing plan on a new session branch." : "Executing plan on the same branch.", "info");
    pi.sendUserMessage(buildExecutionPrompt(planItems, useNewBranch));
  }

  async function finishPlanBranch(ctx: ExtensionCommandContext, summarize: boolean): Promise<void> {
    const originId = planOriginId;
    if (!originId) {
      ctx.ui.notify("Not in a plan execution branch.", "info");
      return;
    }

    try {
      const result = await ctx.navigateTree(originId, {
        summarize,
        customInstructions: summarize ? PLAN_BRANCH_SUMMARY_PROMPT : undefined,
        replaceInstructions: summarize,
      });
      if (result.cancelled) {
        ctx.ui.notify("Navigation cancelled. Run /end-plan to try again.", "info");
        return;
      }
    } catch (error) {
      ctx.ui.notify(`Failed to return from plan branch: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }

    planModeEnabled = false;
    executionMode = false;
    planOriginId = undefined;
    planItems = [];
    restoreTools({ forget: true });
    persistState();
    updateStatus(ctx);

    if (summarize && !ctx.ui.getEditorText().trim()) {
      ctx.ui.setEditorText("Review the plan execution summary and decide next steps.");
    }
    ctx.ui.notify(summarize ? "Returned and summarized plan execution." : "Returned to the plan branch.", "info");
  }

  pi.registerCommand("plan", {
    description: "Toggle plan mode (read-only planning)",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (["on", "start", "enter"].includes(action)) {
        enterPlanMode(ctx);
      } else if (["off", "stop", "exit"].includes(action)) {
        exitPlanMode(ctx);
      } else if (planModeEnabled) {
        exitPlanMode(ctx);
      } else {
        enterPlanMode(ctx);
      }
    },
  });

  pi.registerCommand("execute-plan", {
    description: "Execute the captured plan, choosing same branch or new branch",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/execute-plan requires interactive mode.", "error");
        return;
      }

      await ctx.waitForIdle();

      const latestPlan = findLatestPlanItems(ctx);
      if (latestPlan.length > 0 && !samePlan(latestPlan, planItems)) {
        planItems = latestPlan;
      }

      if (planItems.length === 0) {
        const proceed = await ctx.ui.confirm(
          "No numbered plan detected",
          "No assistant response with a numbered 'Plan:' section was found. Execute the discussed plan anyway?",
        );
        if (!proceed) {
          ctx.ui.notify("Execution cancelled.", "info");
          return;
        }
      }

      const choice = await ctx.ui.select("Execute plan in:", ["Same branch", "New branch"]);
      if (!choice) {
        ctx.ui.notify("Execution cancelled.", "info");
        return;
      }

      await startExecution(ctx, choice === "New branch");
    },
  });

  pi.registerCommand("end-plan", {
    description: "Return from a plan execution branch",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/end-plan requires interactive mode.", "error");
        return;
      }

      await ctx.waitForIdle();

      if (!planOriginId) {
        applyState(ctx, { allowPlanFlag: false });
      }
      if (!planOriginId) {
        ctx.ui.notify("Not in a plan execution branch.", "info");
        return;
      }

      const choice = await ctx.ui.select("Finish plan execution branch:", ["Go back", "Go back and summarize"]);
      if (!choice) {
        ctx.ui.notify("Cancelled. Run /end-plan to try again.", "info");
        return;
      }

      await finishPlanBranch(ctx, choice === "Go back and summarize");
    },
  });

  pi.registerCommand("plan-status", {
    description: "Show plan-mode state and progress",
    handler: async (_args, ctx) => {
      if (planItems.length === 0) {
        ctx.ui.notify(planModeEnabled ? "Plan mode active; no numbered plan captured yet." : "No active plan.", "info");
        return;
      }
      const list = planItems.map((item) => `${item.step}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
      ctx.ui.notify(`Plan progress:\n${list}`, "info");
    },
  });

  pi.registerShortcut("ctrl+alt+p", {
    description: "Toggle plan mode",
    handler: async (ctx) => {
      if (planModeEnabled) exitPlanMode(ctx);
      else enterPlanMode(ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    applyState(ctx, { allowPlanFlag: true });
  });

  pi.on("session_tree", (_event, ctx) => {
    applyState(ctx, { allowPlanFlag: false });
  });

  pi.on("before_agent_start", (event) => {
    if (planModeEnabled) {
      return { systemPrompt: `${event.systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}` };
    }

    if (executionMode) {
      const planText = planItems.length > 0 ? `\n\nCurrent plan:\n${formatPlanItems(planItems)}` : "";
      return { systemPrompt: `${event.systemPrompt}\n\n${PLAN_EXECUTION_SYSTEM_PROMPT}${planText}` };
    }
  });

  pi.on("tool_call", async (event) => {
    if (!planModeEnabled) return;

    const allowedTools = getPlanToolNames();
    if (!allowedTools.includes(event.toolName)) {
      return {
        block: true,
        reason: `Plan mode: tool '${event.toolName}' is not available during read-only planning. Run /execute-plan to implement.`,
      };
    }

    if (event.toolName === "bash") {
      const input = event.input as { command?: unknown };
      const command = typeof input.command === "string" ? input.command : "";
      if (!isSafeCommand(command)) {
        return {
          block: true,
          reason: `Plan mode: blocked non-read-only bash command. Run /execute-plan to implement.\nCommand: ${command}`,
        };
      }
    }
  });

  pi.on("turn_end", (event, ctx) => {
    if (!executionMode || planItems.length === 0 || !isAssistantMessage(event.message)) return;
    if (markCompletedSteps(getTextContent(event.message), planItems) > 0) {
      persistState();
      updateStatus(ctx);
    }
  });

  pi.on("agent_end", (event, ctx) => {
    if (planModeEnabled) {
      const lastAssistant = findLastAssistant(event.messages);
      if (!lastAssistant) return;

      const extracted = extractPlanItems(getTextContent(lastAssistant));
      if (extracted.length === 0) return;

      const changed = !samePlan(extracted, planItems);
      planItems = extracted;
      persistState();
      updateStatus(ctx);
      if (changed && ctx.hasUI) {
        ctx.ui.notify(`Captured a ${planItems.length}-step plan. Run /execute-plan when ready.`, "info");
      }
      return;
    }

    if (!executionMode || planItems.length === 0) return;

    const lastAssistant = findLastAssistant(event.messages);
    if (lastAssistant) markCompletedSteps(getTextContent(lastAssistant), planItems);

    if (!planItems.every((item) => item.completed)) {
      persistState();
      updateStatus(ctx);
      return;
    }

    executionMode = false;
    pi.sendMessage(
      {
        customType: "plan-mode-complete",
        content: planOriginId
          ? "Plan execution complete. Run /end-plan to go back, optionally with a summary."
          : "Plan execution complete.",
        display: true,
      },
      { triggerTurn: false },
    );

    if (!planOriginId) {
      planItems = [];
      previousActiveTools = undefined;
    }

    persistState();
    updateStatus(ctx);
  });
}
