/**
 * Session naming extension.
 *
 * Shows setSessionName/getSessionName to give sessions friendly names
 * that appear in the session selector instead of the first message.
 *
 * Usage: /session-name [name] - set or show session name
 *
 * It also auto-names a session on shutdown if the session is persisted
 * and does not already have a name.
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type MessageEntry = {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

type TextBlock = {
  type?: string;
  text?: string;
};

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((block): block is TextBlock => Boolean(block) && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function compactText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function sanitizeSessionName(text: string): string | undefined {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  const cleaned = firstLine
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/^[\-*\d.)\s]+/, "")
    .replace(/[^A-Za-z0-9 _-]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");

  return cleaned || undefined;
}

function buildConversationExcerpt(entries: MessageEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message?.role) {
      continue;
    }

    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const text = compactText(extractText(entry.message.content), 240);
    if (!text) {
      continue;
    }

    lines.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
  }

  if (lines.length <= 8) {
    return lines.join("\n\n");
  }

  return [...lines.slice(0, 2), ...lines.slice(-6)].join("\n\n");
}

function buildFallbackSessionName(entries: MessageEntry[]): string | undefined {
  const firstUserMessage = entries.find(
    (entry) => entry.type === "message" && entry.message?.role === "user",
  );
  const rawText = extractText(firstUserMessage?.message?.content).trim();
  if (!rawText) {
    return undefined;
  }

  const strippedPrefix = rawText.replace(
    /^(please|can you|could you|would you|help me|i need you to|lets|let's)\s+/i,
    "",
  );
  const cleaned = sanitizeSessionName(strippedPrefix) || sanitizeSessionName(rawText);
  if (!cleaned) {
    return undefined;
  }

  return sanitizeSessionName(
    cleaned
      .split(/[-\s]+/)
      .filter((word) => word.length > 0)
      .slice(0, 7)
      .join(" "),
  );
}

async function generateSessionName(ctx: ExtensionContext): Promise<string | undefined> {
  const entries = ctx.sessionManager.getBranch() as MessageEntry[];
  const fallbackName = buildFallbackSessionName(entries);
  const conversationExcerpt = buildConversationExcerpt(entries);
  const namingModel = ctx.model;

  if (!conversationExcerpt || !namingModel) {
    return fallbackName;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(namingModel);
  if (!auth.ok || !auth.apiKey) {
    return fallbackName;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await complete(
      namingModel,
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Create a short session title for this coding session.",
                  "Return only the title.",
                  "Constraints:",
                  "- ASCII only",
                  "- kebab-case only",
                  "- 3 to 6 words when possible",
                  "- No quotes",
                  "- No markdown",
                  "- Max 36 characters",
                  "- Prefer concrete task names over generic labels",
                  "",
                  "<conversation>",
                  conversationExcerpt,
                  "</conversation>",
                ].join("\n"),
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 32,
        signal: controller.signal,
      },
    );

    const text = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return sanitizeSessionName(text) || fallbackName;
  } catch {
    return fallbackName;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("session-name", {
    description: "Set or show session name (usage: /session-name [new name])",
    handler: async (args, ctx) => {
      const name = args.trim();

      if (name) {
        const sanitizedName = sanitizeSessionName(name);
        if (!sanitizedName) {
          ctx.ui.notify("Invalid session name", "error");
          return;
        }

        pi.setSessionName(sanitizedName);
        ctx.ui.notify(`Session named: ${sanitizedName}`, "info");
      } else {
        const current = pi.getSessionName();
        ctx.ui.notify(current ? `Session: ${current}` : "No session name set", "info");
      }
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (pi.getSessionName() || !ctx.sessionManager.getSessionFile()) {
      return;
    }

    const name = await generateSessionName(ctx);
    if (name) {
      pi.setSessionName(name);
    }
  });
}
