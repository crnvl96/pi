import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

function setSessionName(pi: ExtensionAPI, ctx: ExtensionContext, name: string) {
  pi.setSessionName(name);
  ctx.ui.notify(`Session named: ${name}`, "info");
}

async function promptForSessionName(pi: ExtensionAPI, ctx: ExtensionContext) {
  const current = pi.getSessionName();
  const name = (await ctx.ui.input("Session name:", current || "New session name"))?.trim();

  if (!name) return;

  setSessionName(pi, ctx, name);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("rename", {
    description: "Set or show session name (usage: /rename [new name])",
    handler: async (args, ctx) => {
      const name = args.trim();

      if (name) {
        setSessionName(pi, ctx, name);
      } else {
        const current = pi.getSessionName();
        ctx.ui.notify(current ? `Session: ${current}` : "No session name set", "info");
      }
    },
  });

  pi.registerShortcut("alt+r", {
    description: "Rename session",
    handler: async (ctx) => {
      await promptForSessionName(pi, ctx);
    },
  });
}
