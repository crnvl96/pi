import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type MsgLvl = "info" | "warning" | "error";
type Ctx = {
  ui: {
    notify: (message: string, type?: MsgLvl) => void;
  };
};

export default function (pi: ExtensionAPI) {
  const setOrShowSessionName = async (name: string, ctx: Ctx) => {
    if (name) {
      pi.setSessionName(name);
      ctx.ui.notify(`Session named: ${name}`, "info");
      return;
    }

    const current = pi.getSessionName();
    ctx.ui.notify(current ? `Session: ${current}` : "No session name set", "info");
  };

  pi.registerCommand("rename", {
    description: "Set or show session name (usage: /rename [new name])",
    handler: async (args, ctx) => {
      await setOrShowSessionName(args.trim(), ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+r", {
    description: "Rename session",
    handler: async (ctx) => {
      const current = pi.getSessionName();
      const name = await ctx.ui.input("Session name", current ?? "Enter a new session name");
      if (name === undefined) return;
      await setOrShowSessionName(name.trim(), ctx);
    },
  });
}
