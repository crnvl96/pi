import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

type DangerousPattern = {
  pattern: RegExp;
  label: string;
};

// prettier-ignore
const dangerousPatterns: DangerousPattern[] = [
  { label: "rm",                               pattern: /\brm\b/i                                   },
  { label: "sudo",                             pattern: /\bsudo\b/i                                 },
  { label: "prune",                            pattern: /\bprune\b/i                                },
  { label: "chmod",                            pattern: /\bchmod\b/i                                },
  { label: "delete",                           pattern: /\bdelete\b/i                               },
  { label: "deletion",                         pattern: /\bdeletion\b/i                             },
  { label: "force",                            pattern: /\bforce\b/i                                },
  { label: "reset",                            pattern: /\breset\b/i                                },
  { label: "terminate",                        pattern: /\bterminate\b/i                            },
  { label: "clean",                            pattern: /\bclean\b/i                                },
  { label: "git branch -D",                    pattern: /\bgit\s+branch\s+-D\b/i                    },
  { label: "git checkout",                     pattern: /\bgit\s+checkout\b/i                       },
  { label: "git restore",                      pattern: /\bgit\s+restore\b/i                        },
  { label: "git push",                         pattern: /\bgit\s+push\b/i                           },
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return undefined;
    }

    const command = String(event.input.command ?? "");
    const match = dangerousPatterns.find(({ pattern }) => pattern.test(command));

    if (!match) {
      return undefined;
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Dangerous command blocked (no UI for confirmation): ${match.label}`,
      };
    }

    const allowed = await ctx.ui.confirm(
      "Dangerous command",
      `${command}\n\nDetected: ${match.label}\n\nAllow execution?`,
    );

    if (!allowed) {
      return { block: true, reason: `Blocked by user: ${match.label}` };
    }

    return undefined;
  });
}
