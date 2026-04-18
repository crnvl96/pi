import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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

const searchRecencySchema = Type.Union([
  Type.Literal("hour"),
  Type.Literal("day"),
  Type.Literal("week"),
  Type.Literal("month"),
  Type.Literal("year"),
]);

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const authFilePath = path.join(extensionDir, "..", "..", "auth.json");

function clampResults(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Math.max(1, Math.min(20, value));
}

function compactList(values: string[] | undefined): string[] | undefined {
  if (!values) {
    return undefined;
  }

  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);

  return cleaned.length > 0 ? cleaned : undefined;
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

async function readApiKey(): Promise<string> {
  const auth = JSON.parse(await readFile(authFilePath, "utf8")) as {
    perplexity?: {
      apiKey?: string;
    };
  };

  return auth.perplexity?.apiKey?.trim() ?? "";
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

export default function perplexitySearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "perplexity_web_search",
    label: "Perplexity Web Search",
    description: "Search the web using the Perplexity Search API and return ranked results.",
    promptSnippet:
      "Search the web using Perplexity when up-to-date external information is needed.",
    promptGuidelines: [
      "Use this tool when the user asks for current web information, news, docs, or sources outside the local codebase.",
      "Prefer this tool over bash/curl for web search when up-to-date external information is needed.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      max_results: Type.Optional(
        Type.Integer({
          description: "Maximum number of results to return, from 1 to 20. Defaults to 5.",
          minimum: 1,
          maximum: 20,
        }),
      ),
      country: Type.Optional(
        Type.String({
          description: "Optional ISO 3166-1 alpha-2 country code",
          minLength: 2,
          maxLength: 2,
        }),
      ),
      max_tokens: Type.Optional(
        Type.Integer({
          description: "Optional maximum tokens for context",
          minimum: 1,
          maximum: 1000000,
        }),
      ),
      max_tokens_per_page: Type.Optional(
        Type.Integer({
          description: "Optional maximum tokens per page",
          minimum: 1,
          maximum: 1000000,
        }),
      ),
      search_language_filter: Type.Optional(
        Type.Array(Type.String({ minLength: 2, maxLength: 2 }), {
          description: "Optional ISO 639-1 language codes",
          maxItems: 20,
        }),
      ),
      search_domain_filter: Type.Optional(
        Type.Array(Type.String({ maxLength: 253 }), {
          description: "Optional list of domains to limit search results to",
          maxItems: 20,
        }),
      ),
      search_recency_filter: Type.Optional(searchRecencySchema),
      last_updated_after_filter: Type.Optional(
        Type.String({ description: "Return results updated after this date in MM/DD/YYYY format" }),
      ),
      last_updated_before_filter: Type.Optional(
        Type.String({
          description: "Return results updated before this date in MM/DD/YYYY format",
        }),
      ),
      search_after_date_filter: Type.Optional(
        Type.String({
          description: "Return results published after this date in MM/DD/YYYY format",
        }),
      ),
      search_before_date_filter: Type.Optional(
        Type.String({
          description: "Return results published before this date in MM/DD/YYYY format",
        }),
      ),
    }),
    execute: async (_toolCallId, params, signal) => {
      const payload: ApiSearchRequest = {
        query: params.query.trim(),
        max_results: clampResults(params.max_results ?? 5),
        country: params.country?.trim().toUpperCase(),
        max_tokens: params.max_tokens,
        max_tokens_per_page: params.max_tokens_per_page,
        search_language_filter: compactList(params.search_language_filter)?.map((value) =>
          value.toLowerCase(),
        ),
        search_domain_filter: compactList(params.search_domain_filter),
        search_recency_filter: params.search_recency_filter,
        last_updated_after_filter: params.last_updated_after_filter?.trim(),
        last_updated_before_filter: params.last_updated_before_filter?.trim(),
        search_after_date_filter: params.search_after_date_filter?.trim(),
        search_before_date_filter: params.search_before_date_filter?.trim(),
      };

      if (!payload.query) {
        throw new Error("query must not be empty");
      }

      const result = await searchWeb(payload, signal);
      const renderedResults =
        result.results.length > 0
          ? result.results.map((page, index) => formatResult(page, index)).join("\n\n")
          : "No results returned.";

      return {
        content: [
          {
            type: "text",
            text: `Perplexity web search context for: ${payload.query}\n\nUse the numbered results below as external context and cite URLs when relevant.\n\n${renderedResults}`,
          },
        ],
        details: {
          request: payload,
          response: result,
        },
      };
    },
  });
}
