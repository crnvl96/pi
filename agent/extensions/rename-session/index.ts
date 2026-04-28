import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ext:rename-session", {
    description: "Set or rename the current session (usage: /ext:rename-session [name])",
    handler: async (args, ctx) => {
      const applyName = (name: string) => {
        const previousName = pi.getSessionName();
        pi.setSessionName(name);
        ctx.ui.notify(previousName ? `Session renamed: ${name}` : `Session named: ${name}`, "info");
      };

      const nameFromArgs = args.trim();
      if (nameFromArgs) {
        applyName(nameFromArgs);
        return;
      }

      if (!ctx.hasUI) {
        pi.sendMessage(
          {
            customType: "rename-session",
            content: "Usage: /ext:rename-session [name]",
            display: true,
          },
          { triggerTurn: false },
        );
        return;
      }

      const currentName = pi.getSessionName();
      const enteredName = await ctx.ui.input(
        currentName ? `Rename session (current: ${currentName})` : "Name this session",
        currentName ?? "Session name",
      );
      if (enteredName === undefined) {
        ctx.ui.notify("Session rename cancelled", "info");
        return;
      }

      const name = enteredName.trim();
      if (!name) {
        ctx.ui.notify("Session name unchanged", "warning");
        return;
      }

      applyName(name);
    },
  });
}
