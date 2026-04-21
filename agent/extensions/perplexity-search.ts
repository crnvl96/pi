/*
# Perplexity Search pi extension

This extension adds a `perplexity_web_search` tool to pi.

## Auth

Preferred: set `PERPLEXITY_API_KEY` in your environment.

Alternative: store the Perplexity API key in `~/.pi/agent/auth.json` under `perplexity.apiKey`.

Example:

```json
{
  "perplexity": {
    "apiKey": "your-api-key"
  }
}
```

## Tool

`perplexity_web_search`

Use it to search the web with the Perplexity Search API.

## Notes

- This extension calls `POST https://api.perplexity.ai/search` directly with `fetch()`.
- No Perplexity SDK dependency is required.
- The tool returns formatted text plus the raw API response in `details`.
- Formatted output is truncated to pi's standard line and byte limits. When truncation happens, the full text is written to a temp file and the path is included in the tool output.
*/

import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path, { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

type SearchRecencyFilter = "hour" | "day" | "week" | "month" | "year";

type ApiSearchRequest = {
  query: string;
  max_results?: number;
  country?: string;
  max_tokens?: number;
  max_tokens_per_page?: number;
  search_language_filter?: string[];
  search_domain_filter?: string[];
  last_updated_after_filter?: string;
  last_updated_before_filter?: string;
  search_after_date_filter?: string;
  search_before_date_filter?: string;
  search_recency_filter?: SearchRecencyFilter;
};

type ApiSearchPage = {
  title: string;
  url: string;
  snippet: string;
  date?: string | null;
  last_updated?: string | null;
};

type ApiSearchResponse = {
  results: ApiSearchPage[];
  id: string;
  server_time?: string | null;
};

interface PerplexitySearchDetails {
  request: ApiSearchRequest;
  response: ApiSearchResponse;
  resultCount: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

const authFilePath = path.join(homedir(), ".pi", "agent", "auth.json");

const opts = {
  max_results: 5,
  country: undefined,
  max_tokens: undefined,
  max_tokens_per_page: undefined,
  search_language_filter: ["en"],
  search_domain_filter: undefined,
  search_recency_filter: undefined,
  last_updated_after_filter: undefined,
  last_updated_before_filter: undefined,
  search_after_date_filter: undefined,
  search_before_date_filter: undefined,
} satisfies Omit<ApiSearchRequest, "query">;

function compactList(values: string[] | undefined): string[] | undefined {
  if (!values) {
    return undefined;
  }
  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function buildPayload(query: string): ApiSearchRequest {
  const payload: ApiSearchRequest = {
    query: query.trim(),
    max_results: opts.max_results,
    country: opts.country?.trim().toUpperCase(),
    max_tokens: opts.max_tokens,
    max_tokens_per_page: opts.max_tokens_per_page,
    search_language_filter: compactList(opts.search_language_filter),
    search_domain_filter: compactList(opts.search_domain_filter),
    search_recency_filter: opts.search_recency_filter,
    last_updated_after_filter: opts.last_updated_after_filter?.trim(),
    last_updated_before_filter: opts.last_updated_before_filter?.trim(),
    search_after_date_filter: opts.search_after_date_filter?.trim(),
    search_before_date_filter: opts.search_before_date_filter?.trim(),
  };

  if (!payload.query) {
    throw new Error("query must not be empty");
  }

  return payload;
}

async function readApiKey(): Promise<string> {
  const envApiKey = process.env.PERPLEXITY_API_KEY?.trim();
  if (envApiKey) {
    return envApiKey;
  }

  try {
    const auth = JSON.parse(await readFile(authFilePath, "utf8")) as {
      perplexity?: {
        apiKey?: string;
      };
    };

    const fileApiKey = auth.perplexity?.apiKey?.trim();
    if (fileApiKey) {
      return fileApiKey;
    }
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error(
    `Missing Perplexity API key. Set PERPLEXITY_API_KEY or add perplexity.apiKey to ${authFilePath}`,
  );
}

async function searchWeb(
  params: ApiSearchRequest,
  signal?: AbortSignal,
): Promise<ApiSearchResponse> {
  const apiKey = await readApiKey();

  const response = await fetch("https://api.perplexity.ai/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Perplexity search failed with status ${response.status}: ${body}`);
  }

  return (await response.json()) as ApiSearchResponse;
}

function getDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function formatResult(page: ApiSearchPage, index: number): string {
  const meta: string[] = [];
  const domain = getDomain(page.url);
  if (domain) {
    meta.push(`domain: ${domain}`);
  }
  if (page.date) {
    meta.push(`published: ${page.date}`);
  }
  if (page.last_updated) {
    meta.push(`updated: ${page.last_updated}`);
  }

  const metaLine = meta.length > 0 ? `${meta.join(" | ")}\n` : "";
  return `[${index + 1}] ${page.title}\n${page.url}\n${metaLine}snippet: ${page.snippet}`;
}

function formatSearchContext(query: string, pages: ApiSearchPage[]): string {
  const renderedResults =
    pages.length > 0
      ? pages.map((page, index) => formatResult(page, index)).join("\n\n")
      : "No results returned.";

  return `Perplexity web search context for: ${query}\n\nUse the numbered results below as external context and cite URLs when relevant.\n\n${renderedResults}`;
}

export default function perplexitySearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "perplexity_web_search",
    label: "Perplexity Web Search",
    description: `Search the web using the Perplexity Search API and return ranked results. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). If truncated, full output is saved to a temp file.`,
    promptSnippet:
      "Search the web using Perplexity when up-to-date external information is needed. Rewrite the user's wording into a strong web search query when helpful, and run multiple focused searches if that is more likely to find better results.",
    promptGuidelines: [
      "Use this tool when the user asks for current web information, news, docs, or sources outside the local codebase.",
      "Prefer this tool over bash/curl for web search when up-to-date external information is needed.",
      "Do not feel forced to use the user's words literally. Extract the real intent, entities, constraints, and time range, then turn that into a better search query.",
      "When useful, broaden, narrow, or rephrase the query to improve recall and precision.",
      "If one query is unlikely to be enough, run multiple targeted searches that cover different interpretations or subtopics, then synthesize the results.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    execute: async (_toolCallId, params, signal) => {
      const payload = buildPayload(params.query);
      const result = await searchWeb(payload, signal);
      const fullText = formatSearchContext(payload.query, result.results);
      const truncation = truncateHead(fullText, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      const details: PerplexitySearchDetails = {
        request: payload,
        response: result,
        resultCount: result.results.length,
      };

      let resultText = truncation.content;

      if (truncation.truncated) {
        const tempDir = await mkdtemp(join(tmpdir(), "pi-perplexity-search-"));
        const tempFile = join(tempDir, "output.txt");
        await writeFile(tempFile, fullText, "utf8");

        details.truncation = truncation;
        details.fullOutputPath = tempFile;

        const truncatedLines = truncation.totalLines - truncation.outputLines;
        const truncatedBytes = truncation.totalBytes - truncation.outputBytes;

        resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
        resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
        resultText += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
        resultText += ` Full output saved to: ${tempFile}]`;
      }

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
        details,
      };
    },
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("perplexity_web_search "));
      text += theme.fg("accent", `"${args.query}"`);
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, _context) {
      const details = result.details as PerplexitySearchDetails | undefined;

      if (isPartial) {
        return new Text(theme.fg("warning", "Searching web..."), 0, 0);
      }

      if (!details) {
        return new Text(theme.fg("dim", "No results"), 0, 0);
      }

      const label = details.resultCount === 1 ? "1 result" : `${details.resultCount} results`;
      let text = theme.fg(details.resultCount > 0 ? "success" : "dim", label);

      if (details.truncation?.truncated) {
        text += theme.fg("warning", " (truncated)");
      }

      if (expanded) {
        const content = result.content.find((item) => item.type === "text");
        if (content?.type === "text") {
          const lines = content.text.split("\n");
          const previewLines = lines.slice(0, 16);
          for (const line of previewLines) {
            text += `\n${theme.fg("dim", line)}`;
          }
          if (lines.length > previewLines.length) {
            text += `\n${theme.fg("muted", "... (use read tool to see full output)")}`;
          }
        }

        if (details.fullOutputPath) {
          text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });
}
