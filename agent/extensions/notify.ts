import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// OSC 777 terminal notification escape sequence.
function notify(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

export default function notifyExtension(pi: ExtensionAPI) {
  pi.on("agent_end", () => {
    notify("Pi", "Ready for input");
  });
}
