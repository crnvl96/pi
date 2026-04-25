import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

type DangerousPattern = {
  pattern: RegExp;
  label: string;
};

// prettier-ignore
const dangerousPatterns: DangerousPattern[] = [
  { pattern: /\brm\b[^\n]*\s(?:-[^\s]*r[^\s]*|--recursive)\b/i,              label: "rm with recursive deletion"             },
  { pattern: /\bsudo\b/i,                                                    label: "sudo"                                   },
  { pattern: /\bdd\b[^\n]*(?:\sof=\/dev\/|\sif=\/dev\/)/i,                   label: "dd reading from or writing to a device" },
  { pattern: /\bmkfs(?:\.[a-z0-9_+-]+)?\b[^\n]*\s\/dev\//i,                  label: "mkfs formatting a device"               },
  { pattern: /\bdocker\s+system\s+prune\b[^\n]*(?:\s-a\b|\s--all\b)/i,       label: "docker system prune -a"                 },
  { pattern: /\bdocker\s+(?:container|image|volume|network)\s+prune\b/i,     label: "docker prune"                           },
  { pattern: /\bdocker\s+rm\b[^\n]*\s-f\b/i,                                 label: "docker rm -f"                           },
  { pattern: /\bchmod\b[^\n]*\b777\b/i,                                      label: "chmod 777"                              },
  { pattern: /\bgit\s+reset\b[^\n]*\s--hard\b/i,                             label: "git reset --hard"                       },
  { pattern: /\bgit\s+clean\b[^\n]*\s-[^\s]*(?:f[^\s]*d|d[^\s]*f)[^\s]*\b/i, label: "git clean with -f and -d"               },
  { pattern: /\bgit\s+branch\s+-D\b/i,                                       label: "git branch -D"                          },
  { pattern: /\bgit\s+checkout\b[^\n]*(?:^|\s)\.(?:\s|$)/i,                  label: "git checkout ."                         },
  { pattern: /\bgit\s+restore\b[^\n]*(?:^|\s)\.(?:\s|$)/i,                   label: "git restore ."                          },
  { pattern: /\bgit\s+push\b[^\n]*\s(?:--force|--force-with-lease|-f)\b/i,   label: "git push --force"                       },
  { pattern: /\bgh\s+repo\s+delete\b/i,                                      label: "gh repo delete"                         },
  { pattern: /\bgh\s+release\s+delete\b/i,                                   label: "gh release delete"                      },
  { pattern: /\bgh\s+secret\s+delete\b/i,                                    label: "gh secret delete"                       },
  { pattern: /\bgh\s+variable\s+(?:delete|remove)\b/i,                       label: "gh variable delete"                     },
  { pattern: /\baws\s+s3\s+rm\b[^\n]*\s--recursive\b/i,                      label: "aws s3 rm --recursive"                  },
  { pattern: /\baws\s+s3\s+rb\b[^\n]*\s--force\b/i,                          label: "aws s3 rb --force"                      },
  { pattern: /\baws\s+s3\s+sync\b[^\n]*\s--delete\b/i,                       label: "aws s3 sync --delete"                   },
  { pattern: /\baws\s+ec2\s+terminate-instances\b/i,                         label: "aws ec2 terminate-instances"            },
  { pattern: /\baws\s+cloudformation\s+delete-stack\b/i,                     label: "aws cloudformation delete-stack"        },
  { pattern: /\baws\s+dynamodb\s+delete-table\b/i,                           label: "aws dynamodb delete-table"              },
  { pattern: /\baws\s+lambda\s+delete-function\b/i,                          label: "aws lambda delete-function"             },
  { pattern: /\baws\s+rds\s+delete-db-instance\b/i,                          label: "aws rds delete-db-instance"             },
  { pattern: /\baws\s+secretsmanager\s+delete-secret\b/i,                    label: "aws secretsmanager delete-secret"       },
  { pattern: /\baws\s+kms\s+schedule-key-deletion\b/i,                       label: "aws kms schedule-key-deletion"          },
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
