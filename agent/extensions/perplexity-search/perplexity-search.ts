import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ApiSearchRequest } from "./client.ts";
import { searchWeb, type SearchRecencyFilter } from "./client.ts";
import { formatSearchContext } from "./format.ts";

const searchRecencyOptions = [
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const satisfies readonly SearchRecencyFilter[];

const searchRecencySchema = Type.Union(searchRecencyOptions.map((value) => Type.Literal(value)));

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

function buildPayload(params: {
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
}): ApiSearchRequest {
  const payload: ApiSearchRequest = {
    query: params.query.trim(),
    max_results: clampResults(params.max_results ?? 3),
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

  return payload;
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
          description: "Maximum number of results to return, from 1 to 20. Defaults to 3.",
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
      const payload = buildPayload(params);
      const result = await searchWeb(payload, signal);

      return {
        content: [
          {
            type: "text",
            text: formatSearchContext(payload.query, result.results),
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
