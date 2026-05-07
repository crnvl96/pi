import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const triggerFile = "/tmp/trigger.md";

    fs.watch(triggerFile, () => {
      try {
        const content = fs.readFileSync(triggerFile, "utf-8").trim();
        if (content) {
          pi.sendMessage(
            {
              customType: "file-trigger",
              content: `External trigger: ${content}`,
              display: true,
            },
            { triggerTurn: true },
          );
          fs.writeFileSync(triggerFile, "");
        }
      } catch {}
    });

    if (ctx.hasUI) {
      ctx.ui.notify(`Watching ${triggerFile}`, "info");
    }
  });
}
