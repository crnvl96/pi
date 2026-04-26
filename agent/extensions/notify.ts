import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notify(title: string, body: string): void {
  notifyOSC777(title, body);
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async () => {
    notify("Pi", "Ready for input");
  });
}
