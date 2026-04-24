/*
## Auth

Set `PERPLEXITY_API_KEY` in your environment.
*/

import Perplexity from "@perplexity-ai/perplexity_ai";
import type {
  SearchCreateParams,
  SearchCreateResponse,
} from "@perplexity-ai/perplexity_ai/resources/search";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_TOKENS = 20000;
const DEFAULT_MAX_TOKENS_PER_PAGE = 4096;
const DEFAULT_SEARCH_LANGUAGE_FILTER = ["en"];

function readApiKey(): string {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim();
  if (apiKey) {
    return apiKey;
  }

  throw new Error("Missing Perplexity API key. Set PERPLEXITY_API_KEY in the environment.");
}

let client: Perplexity | undefined;
function getClient(): Perplexity {
  if (!client) {
    client = new Perplexity({
      apiKey: readApiKey(),
      maxRetries: DEFAULT_MAX_RETRIES,
      timeout: DEFAULT_TIMEOUT_MS,
      defaultHeaders: {
        "User-Agent": "pi-perplexity-web/1.0",
      },
    });
  }

  return client;
}

function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("query must be a string");
  }

  const query = value.trim();

  if (!query) {
    throw new Error("query must not be empty");
  }

  return query;
}

function formatResult(page: SearchCreateResponse.Result, index: number): string {
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
  return `[${index}] ${page.title}\n${page.url}\n${metaLine}page extract: ${page.snippet}`;
}

function formatContext(query: string, results: SearchCreateResponse.Result[]): string {
  const renderedResults =
    results.length > 0
      ? results.map((page, index) => formatResult(page, index + 1)).join("\n\n")
      : "No results returned.";

  return `Perplexity web search context for query: ${query}\n\nUse the numbered results below as external context and cite URLs when relevant.\n\n${renderedResults}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Perplexity Web Search",
    description: "Search the web and return concise page context for the agent.",
    promptSnippet: "Search the web when external context would help answer the user.",
    promptGuidelines: [
      "Use this tool only when local context is not enough or current external information is needed.",
      "Write one focused search query.",
      "Use the returned snippets as context and cite URLs when relevant.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "Search query",
      }),
    }),
    execute: async (_toolCallId, params, signal) => {
      const query = normalizeQuery(params.query);
      const payload: SearchCreateParams = {
        query,
        max_results: DEFAULT_MAX_RESULTS,
        max_tokens: DEFAULT_MAX_TOKENS,
        max_tokens_per_page: DEFAULT_MAX_TOKENS_PER_PAGE,
        search_language_filter: DEFAULT_SEARCH_LANGUAGE_FILTER,
      };

      const result = await getClient().search.create(payload, { signal });

      return {
        content: [
          {
            type: "text",
            text: formatContext(query, result.results),
          },
        ],
        details: {
          query,
          resultCount: result.results.length,
          responseId: result.id,
        },
      };
    },
    renderCall(args, theme, _context) {
      return new Text(
        theme.fg("toolTitle", theme.bold("web_search ")) +
          theme.fg("accent", `"${String(args.query ?? "")}"`),
        0,
        0,
      );
    },
  });
}
