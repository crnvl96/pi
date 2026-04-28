import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

const dangerousCommandRules = [
  { label: "rm", pattern: /\brm\b/i },
  { label: "sudo", pattern: /\bsudo\b/i },
  { label: "prune", pattern: /\bprune\b/i },
  { label: "chmod", pattern: /\bchmod\b/i },
  { label: "delete", pattern: /\bdelete\b/i },
  { label: "deletion", pattern: /\bdeletion\b/i },
  { label: "force", pattern: /\bforce\b/i },
  { label: "reset", pattern: /\breset\b/i },
  { label: "terminate", pattern: /\bterminate\b/i },
  { label: "clean", pattern: /\bclean\b/i },
  { label: "git branch -D", pattern: /\bgit\s+branch\s+-D\b/i },
  { label: "git checkout", pattern: /\bgit\s+checkout\b/i },
  { label: "git restore", pattern: /\bgit\s+restore\b/i },
  { label: "git push", pattern: /\bgit\s+push\b/i },
];

export default function permissionGateExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = String(event.input.command ?? "");
    const match = dangerousCommandRules.find(({ pattern }) => pattern.test(command));

    if (!match) return;

    if (!ctx.hasUI)
      return {
        block: true,
        reason: `Dangerous command blocked (no UI for confirmation): ${match.label}`,
      };

    const header = "Dangerous command";
    const msg = `${command}\n\nDetected: ${match.label}\n\nAllow execution?`;

    if (!(await ctx.ui.confirm(header, msg)))
      return {
        block: true,
        reason: `Blocked by user: ${match.label}`,
      };
  });
}
