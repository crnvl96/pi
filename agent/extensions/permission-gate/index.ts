import {
  isToolCallEventType,
  type ExtensionAPI,
  type ToolCallEventResult,
} from "@mariozechner/pi-coding-agent";
import { PERMISSION_GATE_BASH_PATTERNS } from "./utils.js";

type PermissionGateResult = ToolCallEventResult | undefined;

export default function PermissionGate(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx): Promise<PermissionGateResult> => {
    if (!isToolCallEventType("bash", event)) return;

    const command: string = String(event.input.command ?? "");
    const match: RegExp | undefined = PERMISSION_GATE_BASH_PATTERNS.find((pattern) =>
      pattern.test(command),
    );

    if (!match) return;

    if (!ctx.hasUI)
      return {
        block: true,
        reason: `Permission gate blocked command (no UI for confirmation): ${match}`,
      };

    const header: string = "Permission gate";
    const msg: string = `Potentially dangerous command:\n\n${command}\n\nDetected: ${match}\n\nAllow execution?`;

    if (!(await ctx.ui.confirm(header, msg)))
      return {
        block: true,
        reason: `Blocked by permission gate: ${match}`,
      };

    return undefined;
  });
}
