/*
# Perplexity Search pi extension

This extension adds a `perplexity_web_search` tool to pi.

## Auth

Set `PERPLEXITY_API_KEY` in your environment.

## Optional configuration

- `PERPLEXITY_MAX_RETRIES` - SDK retry count, default `3`
- `PERPLEXITY_TIMEOUT` - request timeout in milliseconds, default `30000`
- `PERPLEXITY_MAX_RESULTS` - number of search results to return, default `5`
- `PERPLEXITY_MAX_TOKENS` - total extracted content budget across results, default `20000`
- `PERPLEXITY_MAX_TOKENS_PER_PAGE` - extracted content budget per result, default `4096`

## Tool

`perplexity_web_search`

Use it to search the web with the Perplexity Search API.

## Notes

- This extension uses the official Perplexity TypeScript SDK.
- It calls the Perplexity Search API via `client.search.create()`.
- Search results include extracted page content in the `snippet` field.
- Tool output is returned in full without extension-level truncation.
- The default tool result renderer is used so the returned text is visible in chat.
*/

import Perplexity from "@perplexity-ai/perplexity_ai";
import type {
  SearchCreateParams,
  SearchCreateResponse,
} from "@perplexity-ai/perplexity_ai/resources/search";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

type ApiSearchPage = SearchCreateResponse.Result;

function readApiKey(): string {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim();
  if (apiKey) {
    return apiKey;
  }

  throw new Error("Missing Perplexity API key. Set PERPLEXITY_API_KEY in the environment.");
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer when set.`);
  }

  return value;
}

const DEFAULT_MAX_RETRIES = readPositiveIntEnv("PERPLEXITY_MAX_RETRIES", 3);
const DEFAULT_TIMEOUT_MS = readPositiveIntEnv("PERPLEXITY_TIMEOUT", 30000);
const DEFAULT_MAX_RESULTS = readPositiveIntEnv("PERPLEXITY_MAX_RESULTS", 5);
const DEFAULT_MAX_TOKENS = readPositiveIntEnv("PERPLEXITY_MAX_TOKENS", 20000);
const DEFAULT_MAX_TOKENS_PER_PAGE = readPositiveIntEnv("PERPLEXITY_MAX_TOKENS_PER_PAGE", 4096);

let client: Perplexity | undefined;

function getClient(): Perplexity {
  if (!client) {
    client = new Perplexity({
      apiKey: readApiKey(),
      maxRetries: DEFAULT_MAX_RETRIES,
      timeout: DEFAULT_TIMEOUT_MS,
      defaultHeaders: {
        "User-Agent": "pi-perplexity-search/1.0",
      },
    });
  }

  return client;
}

function formatResult(page: ApiSearchPage, index: number): string {
  const meta: string[] = [];

  try {
    meta.push(`domain: ${new URL(page.url).hostname}`);
  } catch {}

  if (page.date) {
    meta.push(`published: ${page.date}`);
  }

  if (page.last_updated) {
    meta.push(`updated: ${page.last_updated}`);
  }

  const metaLine = meta.length > 0 ? `${meta.join(" | ")}\n` : "";
  return `[${index + 1}] ${page.title}\n${page.url}\n${metaLine}page extract: ${page.snippet}`;
}

function formatSearchContext(query: string, pages: ApiSearchPage[]): string {
  const renderedResults =
    pages.length > 0 ? pages.map(formatResult).join("\n\n") : "No results returned.";

  return `Perplexity web search context for: ${query}\n\nUse the numbered results below as external context and cite URLs when relevant.\nThe page extract text comes from Perplexity Search API snippet extraction, not a separate browser fetch performed by this tool.\n\n${renderedResults}`;
}

export default function perplexitySearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "perplexity_web_search",
    label: "Perplexity Web Search",
    description:
      "Search the web using the Perplexity Search API via the official SDK and return ranked results with extracted page content.",
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
      const query = params.query.trim();

      if (!query) {
        throw new Error("query must not be empty");
      }

      const payload: SearchCreateParams = {
        query,
        max_results: DEFAULT_MAX_RESULTS,
        max_tokens: DEFAULT_MAX_TOKENS,
        max_tokens_per_page: DEFAULT_MAX_TOKENS_PER_PAGE,
        search_language_filter: ["en"],
      };

      const result = await getClient().search.create(payload, { signal });

      return {
        content: [
          {
            type: "text",
            text: formatSearchContext(query, result.results),
          },
        ],
        details: {
          query,
          resultCount: result.results.length,
        },
      };
    },
    renderCall(args, theme, _context) {
      return new Text(
        theme.fg("toolTitle", theme.bold("perplexity_web_search ")) +
          theme.fg("accent", `"${args.query}"`),
        0,
        0,
      );
    },
  });
}
