import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function permissionGateExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = String(event.input.command ?? "");

    const match = [
      /\brm\b/i,
      /\bsudo\b/i,
      /\bprune\b/i,
      /\bchmod\b/i,
      /\bdelete\b/i,
      /\bdeletion\b/i,
      /\bforce\b/i,
      /\breset\b/i,
      /\bterminate\b/i,
      /\bclean\b/i,
      /\bgit\s+branch\s+-D\b/i,
      /\bgit\s+checkout\b/i,
      /\bgit\s+restore\b/i,
      /\bgit\s+push\b/i,
    ].find((pattern) => pattern.test(command));

    if (!match) return;

    if (!ctx.hasUI)
      return {
        block: true,
        reason: `Dangerous command blocked (no UI for confirmation): ${match}`,
      };

    const header = "Dangerous command";
    const msg = `${command}\n\nDetected: ${match}\n\nAllow execution?`;

    if (!(await ctx.ui.confirm(header, msg)))
      return {
        block: true,
        reason: `Blocked by user: ${match}`,
      };
  });
}
