import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentDir = path.resolve(__dirname, "..");
const rulesDir = path.join(agentDir, "rules");

type LoadedRule = {
  relativePath: string;
  content: string;
};

function findMarkdownFiles(dir: string, basePath = ""): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(path.join(dir, entry.name), relativePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

function loadRules(): LoadedRule[] {
  return findMarkdownFiles(rulesDir).map((relativePath) => ({
    relativePath,
    content: fs.readFileSync(path.join(rulesDir, relativePath), "utf8").trim(),
  }));
}

export default function importedRulesExtension(pi: ExtensionAPI) {
  let rules: LoadedRule[] = [];

  pi.on("session_start", async (_event, ctx) => {
    rules = loadRules();

    if (rules.length > 0 && ctx.hasUI) {
      ctx.ui.notify(`Loaded ${rules.length} imported rule(s) from ~/.pi/agent/rules`, "info");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (rules.length === 0) {
      return undefined;
    }

    const renderedRules = rules
      .map(
        (rule) =>
          `### ~/.pi/agent/rules/${rule.relativePath}\n\n\
\`\`\`md\n${rule.content}\n\`\`\``,
      )
      .join("\n\n");

    return {
      systemPrompt:
        event.systemPrompt +
        `

## Imported rules

The user imported the following rule files into pi. Treat them as active guidance.
Follow their scope exactly as written, including any frontmatter such as path filters.

${renderedRules}
`,
    };
  });
}
