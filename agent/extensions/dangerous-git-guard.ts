import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type DangerousPattern = {
  pattern: RegExp;
  label: string;
};

const dangerousGitPatterns: DangerousPattern[] = [
  { pattern: /\bgit\s+reset\s+--hard\b/i, label: "git reset --hard" },
  { pattern: /\bgit\s+clean\s+-fd\b/i, label: "git clean -fd" },
  { pattern: /\bgit\s+clean\s+-f\b/i, label: "git clean -f" },
  { pattern: /\bgit\s+branch\s+-D\b/i, label: "git branch -D" },
  { pattern: /\bgit\s+checkout\s+\./i, label: "git checkout ." },
  { pattern: /\bgit\s+restore\s+\./i, label: "git restore ." },
  { pattern: /\bpush\s+--force\b/i, label: "push --force" },
  { pattern: /\breset\s+--hard\b/i, label: "reset --hard" },
];

export default function dangerousGitGuardExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") {
      return undefined;
    }

    const command = String(event.input.command ?? "");
    if (!/\bgit(\s|$)/.test(command)) {
      return undefined;
    }

    const match = dangerousGitPatterns.find(({ pattern }) => pattern.test(command));
    if (!match) {
      return undefined;
    }

    if (ctx.hasUI) {
      ctx.ui.notify(`Blocked dangerous git command: ${match.label}`, "warning");
    }

    return {
      block: true,
      reason: `Blocked dangerous git command matching pattern: ${match.label}`,
    };
  });
}
