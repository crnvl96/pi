import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ApiSearchRequest } from "./client.ts";
import { searchWeb } from "./client.ts";
import { formatSearchContext } from "./format.ts";

const opts = {
  max_results: 3,
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

export default function perplexitySearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "perplexity_web_search",
    label: "Perplexity Web Search",
    description: "Search the web using the Perplexity Search API and return ranked results.",
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
