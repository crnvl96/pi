import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function buildTmuxAssistedTaskMessage(task: string, cwd: string): string {
  return `This is a one-shot tmux-assisted task.

Original task:
${task}

Current pi working directory:
${cwd}

Use the existing bash tool for tmux commands. bash is required; if bash is unavailable, tell the user to enable it. Do not mutate active tools.

Tmux session creation and targeting defaults:
- Use a tmux session name matching [a-zA-Z0-9_-]+. If the requested name is unsafe or ambiguous, ask or normalize before using it.
- Reuse existing tmux sessions by default. Check first:
  tmux has-session -t '<name>'
- If absent, create a detached shell-only tmux session in the pi working directory:
  tmux new-session -d -s '<name>' -c '${cwd}'
- Create shell-only tmux sessions first, then send initial commands via send-keys.
- Default to one active pane in the default window. Use richer targets like '<name>:<window>.<pane>' only when needed.
- Supporting diagnostics are allowed:
  tmux list-sessions
  tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_current_command}'

Tmux interaction loop:
- Send input with:
  tmux send-keys -t '<name>' -- '<input>' Enter
- Use -- before arbitrary input, quote arbitrary input safely, and submit with explicit \`Enter\` or \`C-m\`.
- For multiline or REPL input, send complete logical chunks and capture after each meaningful step.
- After sending input, wait briefly before capturing, for example:
  sleep 0.2
- Capture output with:
  tmux capture-pane -p -t '<name>' -S -200
- Adjust capture only when useful: use -S - for full history, -E - through the visible end, and -J when joined wrapped lines are more useful than visual layout.
- Detect readiness from prompts and output stability, not process state. Examples include >>>, (Pdb), a shell prompt returning, or repeated captures showing no meaningful change.

Safety, lifecycle, and transcript boundaries:
- Treat commands sent through tmux with the same safety bar as direct bash commands. Do not use tmux to bypass safety or permission expectations.
- For AWS CLI inspection, prefer read-only commands such as describe-*, list-*, and get-*.
- Avoid mutating AWS commands such as delete-*, terminate-*, put-*, update-*, and create-* unless the user explicitly approved them.
- Never kill, replace, or clean up tmux sessions unless explicitly requested.
- Iterate autonomously within the user's task, but pause and ask before handling credentials, destructive actions, unclear intent, or risky unknown state.
- Summarize findings in the final response and quote only relevant captured output. Avoid full pane dumps unless the user asks for them.
- Full-screen TUI apps are not optimized in this minimal version; focus on shell, REPL, debugger, and line-oriented CLI workflows.`;
}

export default function tmuxExtension(pi: ExtensionAPI) {
  pi.registerCommand("tmux", {
    description: "Run a one-shot tmux-assisted task",
    handler: async (args, ctx) => {
      const task = args.trim();

      if (!task) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Usage: /tmux <task>\nExample: /tmux spawn a tmux session named repl and use it as a Python REPL",
            "warning",
          );
        }
        return;
      }

      if (!ctx.isIdle()) {
        if (ctx.hasUI) {
          ctx.ui.notify("Agent is busy. Retry /tmux when the current turn is finished.", "warning");
        }
        return;
      }

      pi.sendUserMessage(buildTmuxAssistedTaskMessage(task, ctx.cwd));
    },
  });
}
