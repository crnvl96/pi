import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

function renameSession(pi: ExtensionAPI, ctx: ExtensionContext, name: string) {
  pi.setSessionName(name);
  ctx.ui.notify(`Session named: ${name}`, "info");
}

function showCurrentSessionName(pi: ExtensionAPI, ctx: ExtensionContext) {
  const current = pi.getSessionName();
  ctx.ui.notify(current ? `Session: ${current}` : "No session name set", "info");
}

async function promptAndRenameSession(pi: ExtensionAPI, ctx: ExtensionContext) {
  const current = pi.getSessionName();
  const name = (await ctx.ui.input("Session name:", current || "New session name"))?.trim();

  if (!name) return;

  renameSession(pi, ctx, name);
}

export default function renameExtension(pi: ExtensionAPI) {
  pi.registerCommand("rename", {
    description: "Set or show session name (usage: /rename [new name])",
    handler: async (args, ctx) => {
      const name = args.trim();

      if (name) {
        renameSession(pi, ctx, name);
        return;
      }

      showCurrentSessionName(pi, ctx);
    },
  });

  pi.registerShortcut("alt+r", {
    description: "Rename session",
    handler: async (ctx) => {
      await promptAndRenameSession(pi, ctx);
    },
  });
}
