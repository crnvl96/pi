/*
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
const MAX_QUERY_WIDTH = 80;

type WebSearchResultHeader = {
  title: string;
  url: string;
  domain?: string;
  date?: string;
  lastUpdated?: string;
};

type WebSearchToolDetails = {
  query: string;
  resultCount: number;
  responseId: string;
  results: WebSearchResultHeader[];
};

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

function getDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function truncateText(text: string, maxWidth = MAX_QUERY_WIDTH): string {
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 3)}...`;
}

function toResultHeader(page: SearchCreateResponse.Result): WebSearchResultHeader {
  return {
    title: page.title,
    url: page.url,
    domain: getDomain(page.url),
    date: page.date ?? undefined,
    lastUpdated: page.last_updated ?? undefined,
  };
}

function formatResult(page: SearchCreateResponse.Result, index: number): string {
  const header = toResultHeader(page);
  const meta: string[] = [];

  if (header.domain) {
    meta.push(`domain: ${header.domain}`);
  }

  if (header.date) {
    meta.push(`published: ${header.date}`);
  }

  if (header.lastUpdated) {
    meta.push(`updated: ${header.lastUpdated}`);
  }

  const metaLine = meta.length > 0 ? `${meta.join(" | ")}\n` : "";
  return `[${index}] ${header.title}\n${header.url}\n${metaLine}page extract: ${page.snippet}`;
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
    promptSnippet:
      "Search the web only after identifying the external fact needed and why local context is insufficient.",
    promptGuidelines: [
      "Use this tool only when local context is not enough or current external information is needed.",
      "If the need is unclear, state the uncertainty or ask instead of searching speculatively.",
      "Write one focused search query that directly serves the user's current goal.",
      "Use the returned snippets as context, surface uncertainty, and cite URLs when relevant.",
      "Do not broaden scope or add follow-up research unless the result is needed to complete the task.",
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
          results: result.results.map(toResultHeader),
        } satisfies WebSearchToolDetails,
      };
    },
    renderCall(args, theme, _context) {
      const query = theme.fg("accent", truncateText(String(args.query ?? "...")));
      return new Text(`${theme.fg("toolTitle", theme.bold("web_search"))} ${query}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "searching"), 0, 0);

      const content = result.content[0];
      if (content?.type === "text" && content.text.toLowerCase().startsWith("error")) {
        return new Text(theme.fg("error", content.text.split("\n")[0]), 0, 0);
      }

      const details = result.details as Partial<WebSearchToolDetails> | undefined;
      const headers = details?.results ?? [];
      const resultCount = details?.resultCount ?? headers.length;
      const countText = resultCount === 1 ? "1 result" : `${resultCount} results`;

      let text = theme.fg("success", countText);
      if (!expanded) return new Text(text, 0, 0);

      for (const [index, header] of headers.entries()) {
        const meta: string[] = [];
        if (header.domain) meta.push(header.domain);
        if (header.date) meta.push(`published: ${header.date}`);
        if (header.lastUpdated) meta.push(`updated: ${header.lastUpdated}`);

        text += `\n${theme.fg("accent", `[${index + 1}] ${header.title}`)}`;
        text += `\n${theme.fg("dim", header.url)}`;
        if (meta.length > 0) text += `\n${theme.fg("dim", meta.join(" | "))}`;
      }

      return new Text(text, 0, 0);
    },
  });
}
