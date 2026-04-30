import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Markdown } from "@mariozechner/pi-tui";

const PROVIDER = "openai-codex";
const MODEL = "gpt-5.3-codex-spark";
const THINKING = "high";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildPrompt(prNumber: string): string {
  return [
    "You are a code review sub-agent.",
    "Review GitHub PR #" + prNumber + " using the GitHub CLI (`gh`).",
    "Use `gh` commands as the primary source for PR metadata, diff, and changed files.",
    "You may inspect local files read-only for additional context around files touched by the PR.",
    "Do not review unrelated local changes. Do not modify files, write patches, or commit changes.",
    "",
    "Review the PR for:",
    "- Bugs and logic errors",
    "- Security issues",
    "- Error handling gaps",
    "",
    "Report concrete findings only. Include severity, file/path and line when available, why it matters, and a suggested fix.",
    "If you find no issues, say so explicitly.",
  ].join("\n");
}

async function withTempPrompt<T>(prompt: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-code-review-"));
  const file = path.join(dir, "prompt.md");
  try {
    await fs.writeFile(file, prompt, { encoding: "utf8", mode: 0o600 });
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer(
    "code-review",
    (message) => new Markdown(String(message.content ?? ""), 0, 0, getMarkdownTheme()),
  );

  pi.registerCommand("code-review", {
    description: "Run a code review sub-agent for a GitHub PR. Usage: /code-review pr 67",
    handler: async (args, ctx) => {
      const match = args.trim().match(/^pr\s+(\d+)$/i);
      if (!match) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /code-review pr 67", "warning");
        return;
      }

      const prNumber = match[1];
      if (ctx.hasUI) ctx.ui.notify(`Reviewing PR #${prNumber}...`, "info");

      await withTempPrompt(buildPrompt(prNumber), async (promptFile) => {
        const piArgs = [
          "--print",
          "--no-session",
          "--provider",
          PROVIDER,
          "--model",
          MODEL,
          "--thinking",
          THINKING,
          "--tools",
          "bash,read,grep,find,ls",
        ];
        const command = `pi ${piArgs.map(shellQuote).join(" ")} < ${shellQuote(promptFile)}`;

        const result = await pi.exec("bash", ["-lc", command], { cwd: ctx.cwd });
        const stdout = result.stdout.trim();
        const stderr = result.stderr.trim();
        const failed = result.code !== 0;

        pi.sendMessage({
          customType: "code-review",
          content: [
            failed
              ? `# Code review failed (exit ${result.code})`
              : `# Code review findings for PR #${prNumber}`,
            stdout || "(No findings reported.)",
            stderr ? `## Sub-agent stderr\n\n\`\`\`\n${stderr}\n\`\`\`` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          display: true,
          details: { prNumber, exitCode: result.code },
        });

        if (ctx.hasUI)
          ctx.ui.notify(
            failed ? "Code review failed" : "Code review complete",
            failed ? "error" : "info",
          );
      });
    },
  });
}
