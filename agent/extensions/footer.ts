import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

function setMinimalFooter(ctx: ExtensionContext) {
  ctx.ui.setFooter((_tui, _theme, _footerData) => ({
    dispose: () => {},
    invalidate() {},
    render(_width: number): string[] {
      return [];
    },
  }));
}

export default function (pi: ExtensionAPI) {
  let enabled = true;

  function toggleFooter(ctx: ExtensionContext) {
    enabled = !enabled;

    if (enabled) {
      setMinimalFooter(ctx);
      ctx.ui.notify("Custom footer enabled", "info");
    } else {
      ctx.ui.setFooter(undefined);
      ctx.ui.notify("Default footer restored", "info");
    }
  }

  pi.on("session_start", (_event, ctx) => {
    setMinimalFooter(ctx);
  });

  pi.registerCommand("footer", {
    description: "Toggle custom footer",
    handler: async (_args, ctx) => {
      toggleFooter(ctx);
    },
  });

  pi.registerShortcut("alt+,", {
    description: "Toggle custom footer",
    handler: async (ctx) => {
      toggleFooter(ctx);
    },
  });
}
