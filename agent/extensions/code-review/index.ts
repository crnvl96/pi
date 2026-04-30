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

function buildPrContext(prMetadata: string, prDiff: string): string {
  return ["=== GH Metadata ===", prMetadata, "", "=== PR Diff ===", prDiff || "(No diff returned.)"].join("\n");
}

async function runGhCommand(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string> {
  const result = await pi.exec("gh", args, { cwd });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  if (result.code !== 0) {
    throw new Error(`gh ${args.join(" ")} failed (exit ${result.code}): ${stderr || "(no stderr)"}`);
  }

  if (!stdout) {
    throw new Error(`gh ${args.join(" ")} returned no output`);
  }

  return stdout;
}

async function getPrReviewContext(pi: ExtensionAPI, cwd: string, prNumber: string): Promise<string> {
  const [metadata, diff] = await Promise.all([
    runGhCommand(pi, cwd, [
      "pr",
      "view",
      prNumber,
      "--json",
      "number,title,body,state,author,baseRefName,headRefName,additions,deletions,changedFiles,url",
    ]),
    runGhCommand(pi, cwd, ["pr", "diff", prNumber]),
  ]);

  return buildPrContext(metadata, diff);
}

function buildPrompt(prNumber: string, reviewContext: string): string {
  return [
    "You are a strict PR review sub-agent.",
    `Review GitHub PR #${prNumber} using ONLY the context provided below (from gh).`,
    "",
    "Rules:",
    "- Do NOT inspect local files or run filesystem commands.",
    "- Do NOT use local context (including shell commands, read, grep, find, ls, cat, or similar).",
    "- Base your findings only on this GH context.",
    "- Report only bugs, security issues, and error-handling issues.",
    "",
    "For each finding include severity (critical/high/medium/low), file/path, line if available, why it matters, and suggested fix.",
    "If you find no issues, say so explicitly.",
    "",
    reviewContext,
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

      try {
        const reviewContext = await getPrReviewContext(pi, ctx.cwd, prNumber);
        const prompt = buildPrompt(prNumber, reviewContext);

        await withTempPrompt(prompt, async (promptFile) => {
          const piArgs = [
            "--print",
            "--no-session",
            "--no-tools",
            "--provider",
            PROVIDER,
            "--model",
            MODEL,
            "--thinking",
            THINKING,
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        pi.sendMessage({
          customType: "code-review",
          content: `# Code review failed\n\n${errorMessage}`,
          display: true,
          details: { prNumber },
        });

        if (ctx.hasUI) ctx.ui.notify("Code review failed", "error");
      }
    },
  });
}
