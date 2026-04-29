import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PERMISSION_GATE_BASH_PATTERNS = [
  /\brm\b/i,
  /\bsudo\b/i,
  /\bprune\b/i,
  /\bchmod\b/i,
  /\bdelete\b/i,
  /\bdeletion\b/i,
  /\breset\b/i,
  /\bterminate\b/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+restore\b/i,
  /\bgit\s+push\b/i,
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = String(event.input.command ?? "");
    const match = PERMISSION_GATE_BASH_PATTERNS.find((pattern) => pattern.test(command));

    if (!match) return;

    if (!ctx.hasUI)
      return {
        block: true,
        reason: `Permission gate blocked command (no UI for confirmation): ${match}`,
      };

    const header = "Permission gate";
    const msg = `Potentially dangerous command:\n\n${command}\n\nDetected: ${match}\n\nAllow execution?`;

    if (!(await ctx.ui.confirm(header, msg)))
      return {
        block: true,
        reason: `Blocked by permission gate: ${match}`,
      };
  });
}
