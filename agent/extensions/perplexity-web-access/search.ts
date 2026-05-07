import { Type } from "typebox";
import { getApiKey } from "./client.js";
import { StringEnum } from "@mariozechner/pi-ai";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
}

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  signal?: AbortSignal;
}

export interface PerplexityApiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: unknown[];
}

export const SearchParams = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        "Single general web search query. For programming/API/docs/code examples, use perplexity-code-search instead. For specific URLs, use perplexity-web-fetch.",
    }),
  ),
  queries: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Multiple general web research queries searched with up to 3 concurrent requests, each returning its own synthesized answer. Prefer this for broad research — vary phrasing, scope, and angle across 2-4 queries. Good: ['React vs Vue performance benchmarks 2026', 'React vs Vue developer experience comparison', 'React ecosystem size vs Vue ecosystem']. Bad: ['React vs Vue', 'React vs Vue comparison', 'React vs Vue review'] (too similar, redundant results).",
    }),
  ),
  numResults: Type.Optional(
    Type.Number({ description: "Results per query (default: 5, max: 20)" }),
  ),
  recencyFilter: Type.Optional(
    StringEnum(["day", "week", "month", "year"] as const, { description: "Filter by recency" }),
  ),
  domainFilter: Type.Optional(
    Type.Array(Type.String(), { description: "Limit to domains (prefix with - to exclude)" }),
  ),
});

export function validateDomainFilter(domains: string[]): string[] {
  return domains.filter((d) => {
    const domain = d.startsWith("-") ? d.slice(1) : d;
    return /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/.test(domain);
  });
}

export async function searchWithPerplexity(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const apiKey = getApiKey();
  const numResults = Math.min(options.numResults ?? 5, 20);

  const requestBody: Record<string, unknown> = {
    model: "sonar",
    messages: [{ role: "user", content: query }],
    max_tokens: 1024,
    return_related_questions: false,
  };

  if (options.recencyFilter) {
    requestBody["search_recency_filter"] = options.recencyFilter;
  }

  if (options.domainFilter && options.domainFilter.length > 0) {
    const validated = validateDomainFilter(options.domainFilter);
    if (validated.length > 0) {
      requestBody["search_domain_filter"] = validated;
    }
  }

  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  };
  if (options.signal) requestInit.signal = options.signal;

  const response = await fetch(PERPLEXITY_API_URL, requestInit);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${errorText}`);
  }

  let data: PerplexityApiResponse;
  try {
    data = (await response.json()) as PerplexityApiResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Perplexity API returned invalid JSON: ${message}`);
  }

  const answer = data.choices?.[0]?.message?.content || "";
  const citations = Array.isArray(data.citations) ? data.citations : [];

  const results: SearchResult[] = [];
  for (let i = 0; i < Math.min(citations.length, numResults); i++) {
    const citation = citations[i];
    if (typeof citation === "string") {
      results.push({ title: `Source ${i + 1}`, url: citation, snippet: "" });
    } else if (citation && typeof citation === "object") {
      const url = "url" in citation ? citation.url : undefined;
      if (typeof url !== "string") continue;
      const title =
        "title" in citation && typeof citation.title === "string"
          ? citation.title
          : `Source ${i + 1}`;
      results.push({ title, url, snippet: "" });
    }
  }

  return { answer, results };
}
