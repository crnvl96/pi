import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const setOrShowSessionName = async (
    name: string,
    ctx: { ui: { notify: (message: string, type?: "info" | "warning" | "error") => void } },
  ) => {
    if (name) {
      pi.setSessionName(name);
      ctx.ui.notify(`Session named: ${name}`, "info");
      return;
    }

    const current = pi.getSessionName();
    ctx.ui.notify(current ? `Session: ${current}` : "No session name set", "info");
  };

  pi.registerCommand("session-name", {
    description: "Set or show session name (usage: /session-name [new name])",
    handler: async (args, ctx) => {
      await setOrShowSessionName(args.trim(), ctx);
    },
  });

  pi.registerShortcut("ctrl+s", {
    description: "Rename session",
    handler: async (ctx) => {
      const current = pi.getSessionName();
      const name = await ctx.ui.input("Session name", current ?? "Enter a new session name");
      if (name === undefined) return;
      await setOrShowSessionName(name.trim(), ctx);
    },
  });
}
