import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function sanitizeOscText(value: string): string {
  // oxlint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f\x1b\x07]/g, " ");
}

function notifyOSC777(title: string, body: string): void {
  const safeTitle = sanitizeOscText(title);
  const safeBody = sanitizeOscText(body);
  process.stdout.write(`\x1b]777;notify;${safeTitle};${safeBody}\x07`);
}

function canNotifyTerminal(): boolean {
  return process.stdout.isTTY === true;
}

function notify(title: string, body: string): void {
  if (!canNotifyTerminal()) {
    return;
  }

  notifyOSC777(title, body);
}

export default function notifyExtension(pi: ExtensionAPI) {
  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    notify("Pi", "Ready");
  });
}
