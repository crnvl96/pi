/*
## Auth

Set `PERPLEXITY_API_KEY` in your environment.
*/

import Perplexity from "@perplexity-ai/perplexity_ai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseCreateResponse,
} from "@perplexity-ai/perplexity_ai/resources/responses";
import type {
  SearchCreateParams,
  SearchCreateResponse,
} from "@perplexity-ai/perplexity_ai/resources/search";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 20;
const DEFAULT_MAX_RESULTS = 5;
const MAX_SEARCH_QUERIES = 5;
const MAX_SEARCH_DOMAINS = 20;
const DEFAULT_MAX_TOKENS = 20000;
const DEFAULT_MAX_TOKENS_PER_PAGE = 4096;
const WEB_FETCH_PRESET = "pro-search";
const MAX_FETCH_URLS = 10;
const DEFAULT_SEARCH_LANGUAGE_FILTER = ["en"];
const SEARCH_RECENCY_FILTERS = ["hour", "day", "week", "month", "year"] as const;
type SearchRecencyFilter = (typeof SEARCH_RECENCY_FILTERS)[number];

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

type SearchResultGroup = SearchCreateResponse.Result[];

function normalizeSearchQueries(rawQuery: unknown): string[] {
  const rawQueries =
    typeof rawQuery === "string"
      ? [rawQuery]
      : Array.isArray(rawQuery) && rawQuery.every((item) => typeof item === "string")
        ? rawQuery
        : undefined;

  if (!rawQueries) {
    throw new Error("query must be a string or an array of strings");
  }

  if (rawQueries.length === 0) {
    throw new Error("query must contain at least one search query");
  }

  if (rawQueries.length > MAX_SEARCH_QUERIES) {
    throw new Error(`query supports at most ${MAX_SEARCH_QUERIES} queries per request`);
  }

  const queries = rawQueries.map((query) => query.trim());
  if (queries.some((query) => !query)) {
    throw new Error("query entries must not be empty");
  }

  return queries;
}

function normalizeMaxResults(rawMaxResults: unknown): number {
  if (rawMaxResults === undefined || rawMaxResults === null) {
    return DEFAULT_MAX_RESULTS;
  }

  if (typeof rawMaxResults !== "number" || !Number.isFinite(rawMaxResults)) {
    throw new Error("max_results must be a finite number");
  }

  return Math.min(MAX_MAX_RESULTS, Math.max(MIN_MAX_RESULTS, Math.trunc(rawMaxResults)));
}

function normalizeSearchDomainFilter(rawFilter: unknown): string[] | undefined {
  if (rawFilter === undefined || rawFilter === null) {
    return undefined;
  }

  if (!Array.isArray(rawFilter) || rawFilter.some((item) => typeof item !== "string")) {
    throw new Error("search_domain_filter must be an array of strings");
  }

  if (rawFilter.length === 0) {
    return undefined;
  }

  if (rawFilter.length > MAX_SEARCH_DOMAINS) {
    throw new Error(`search_domain_filter supports at most ${MAX_SEARCH_DOMAINS} domains`);
  }

  const domains = rawFilter.map((domain) => domain.trim());
  if (domains.some((domain) => !domain || domain === "-")) {
    throw new Error("search_domain_filter entries must not be empty");
  }

  const hasAllowlist = domains.some((domain) => !domain.startsWith("-"));
  const hasDenylist = domains.some((domain) => domain.startsWith("-"));
  if (hasAllowlist && hasDenylist) {
    throw new Error("search_domain_filter cannot mix allowlist and denylist entries");
  }

  return domains;
}

function normalizeSearchRecencyFilter(rawFilter: unknown): SearchRecencyFilter | undefined {
  if (rawFilter === undefined || rawFilter === null) {
    return undefined;
  }

  if (typeof rawFilter !== "string") {
    throw new Error("search_recency_filter must be a string");
  }

  const filter = rawFilter.trim();
  if (SEARCH_RECENCY_FILTERS.includes(filter as SearchRecencyFilter)) {
    return filter as SearchRecencyFilter;
  }

  throw new Error(`search_recency_filter must be one of: ${SEARCH_RECENCY_FILTERS.join(", ")}`);
}

function normalizeOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function isSearchResult(value: unknown): value is SearchCreateResponse.Result {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<SearchCreateResponse.Result>;
  return (
    typeof result.title === "string" &&
    typeof result.url === "string" &&
    typeof result.snippet === "string"
  );
}

function normalizeSearchResultGroups(rawResults: unknown): SearchResultGroup[] {
  if (!Array.isArray(rawResults)) {
    return [];
  }

  if (rawResults.length === 0) {
    return [[]];
  }

  if (rawResults.every(Array.isArray)) {
    return rawResults.map((group) => group.filter(isSearchResult));
  }

  return [rawResults.filter(isSearchResult)];
}

function formatSearchResult(page: SearchCreateResponse.Result, index: number): string {
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

function formatSearchContext(queries: string[], resultGroups: SearchResultGroup[]): string {
  const renderedQueries =
    queries.length === 1
      ? queries[0]
      : `\n${queries.map((query, index) => `[${index + 1}] ${query}`).join("\n")}`;

  let nextResultIndex = 1;
  const renderedResults =
    resultGroups.length > 0
      ? resultGroups
          .map((pages, groupIndex) => {
            const heading =
              queries.length > 1 && resultGroups.length === queries.length
                ? `Results for query ${groupIndex + 1}: ${queries[groupIndex]}\n\n`
                : "";
            if (pages.length === 0) {
              return `${heading}No results returned.`;
            }

            const renderedPages = pages
              .map((page) => formatSearchResult(page, nextResultIndex++))
              .join("\n\n");
            return `${heading}${renderedPages}`;
          })
          .join("\n\n")
      : "No results returned.";

  return `Perplexity web search context for ${queries.length === 1 ? "query" : "queries"}: ${renderedQueries}\n\nUse the numbered results below as external context and cite URLs when relevant.\nThe page extract text comes from Perplexity Search API snippet extraction, not a separate browser fetch performed by this tool.\n\n${renderedResults}`;
}

type FetchedUrlContent = {
  snippet: string;
  title: string;
  url: string;
};

function normalizeFetchUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    throw new Error("url must not be empty");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("url must be an absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must use http:// or https://");
  }

  return url;
}

function normalizeFetchUrls(rawUrl: unknown, rawUrls: unknown): URL[] {
  const values: string[] = [];

  if (rawUrl !== undefined) {
    if (typeof rawUrl === "string") {
      values.push(rawUrl);
    } else if (Array.isArray(rawUrl) && rawUrl.every((item) => typeof item === "string")) {
      values.push(...rawUrl);
    } else {
      throw new Error("url must be a string or an array of strings");
    }
  }

  if (rawUrls !== undefined) {
    if (!Array.isArray(rawUrls) || rawUrls.some((item) => typeof item !== "string")) {
      throw new Error("urls must be an array of strings");
    }
    values.push(...rawUrls);
  }

  if (values.length === 0) {
    throw new Error("provide url or urls");
  }

  const uniqueUrls: URL[] = [];
  const seenUrls = new Set<string>();
  for (const value of values) {
    const url = normalizeFetchUrl(value);
    const normalized = url.toString();
    if (!seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      uniqueUrls.push(url);
    }
  }

  if (uniqueUrls.length > MAX_FETCH_URLS) {
    throw new Error(`web_fetch supports at most ${MAX_FETCH_URLS} URLs per request`);
  }

  return uniqueUrls;
}

function buildFetchInput(urls: URL[]): string {
  const renderedUrls = urls.map((url, index) => `${index + 1}. ${url.toString()}`).join("\n");

  return [
    urls.length === 1
      ? "Fetch the exact URL below and return the page content as useful context for a coding agent."
      : "Fetch the exact URLs below and return the page contents as useful context for a coding agent.",
    urls.length === 1 ? `URL: ${urls[0].toString()}` : `URLs:\n${renderedUrls}`,
    "",
    "Requirements:",
    "- Use only the fetch_url tool.",
    "- Do not run a web search.",
    "- Do not fetch any URL not listed above.",
    "- Fetch the listed URLs in one tool call when possible.",
    "- Preserve headings, API names, configuration keys, commands, and code examples when relevant.",
    "- If any page cannot be fetched, explain the failure briefly.",
  ].join("\n");
}

function extractFetchedUrlContents(response: ResponseCreateResponse): FetchedUrlContent[] {
  const contents: FetchedUrlContent[] = [];

  for (const item of response.output) {
    if (item.type === "fetch_url_results") {
      contents.push(...item.contents);
    }
  }

  return contents;
}

function extractResponseText(response: ResponseCreateResponse): string {
  if (response.output_text?.trim()) {
    return response.output_text.trim();
  }

  const textParts: string[] = [];
  for (const item of response.output) {
    if (item.type !== "message") {
      continue;
    }

    for (const part of item.content) {
      const text = part.text.trim();
      if (text) {
        textParts.push(text);
      }
    }
  }

  return textParts.join("\n\n");
}

function formatFetchedUrlContent(content: FetchedUrlContent, index: number): string {
  return `[${index + 1}] ${content.title}\n${content.url}\npage extract: ${content.snippet}`;
}

function formatFetchContext(
  urls: string[],
  response: ResponseCreateResponse,
  fetchedContents: FetchedUrlContent[],
): string {
  const requestedUrls = urls.map((url, index) => `[${index + 1}] ${url}`).join("\n");
  const fetchedSection =
    fetchedContents.length > 0
      ? fetchedContents.map(formatFetchedUrlContent).join("\n\n")
      : "No fetch_url_results content returned.";
  const responseText = extractResponseText(response);
  const responseSection = responseText
    ? `\n\nModel-generated response (not fetched source content; use only as fetch status or summary):\n\n${responseText}`
    : "";

  return `Perplexity pro-search web fetch context for requested URL(s):\n\n${requestedUrls}\n\nUse the fetched content below as external context and cite URLs when relevant.\nThe page extract text comes from Perplexity Agent API fetch_url using the pro-search preset. Any model-generated response below is not fetched source content.\n\nFetched content:\n\n${fetchedSection}${responseSection}`;
}

function formatRenderArgument(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
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
      "If one query is unlikely to be enough, pass up to 5 targeted queries in one multi-query request.",
      "Set max_results only when the default of 5 results per query is not appropriate; values are clamped to Perplexity's 1..20 range.",
      "Use search_domain_filter to restrict searches to official docs or exclude low-value sources. Do not mix allowlist domains with denylist domains prefixed by '-'.",
      "Use search_recency_filter or date filters when release freshness matters, such as current APIs, changelogs, or recent tool behavior.",
      "Results are restricted to English sources by default.",
    ],
    parameters: Type.Object({
      query: Type.Union([
        Type.String({
          description: "Search query",
        }),
        Type.Array(Type.String(), {
          description: "Up to 5 search queries for one multi-query request",
          maxItems: MAX_SEARCH_QUERIES,
        }),
      ]),
      max_results: Type.Optional(
        Type.Integer({
          description: "Optional result count per query. Values are clamped to 1..20.",
        }),
      ),
      search_domain_filter: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Optional domain allowlist or denylist. Use ['docs.example.com'] to include only domains, or ['-reddit.com'] to exclude domains. Do not mix modes. Maximum 20 domains.",
          maxItems: MAX_SEARCH_DOMAINS,
        }),
      ),
      search_recency_filter: Type.Optional(
        Type.Union([
          Type.Literal("hour"),
          Type.Literal("day"),
          Type.Literal("week"),
          Type.Literal("month"),
          Type.Literal("year"),
        ], {
          description: "Optional recency filter for results.",
        }),
      ),
      search_after_date_filter: Type.Optional(
        Type.String({
          description: "Optional result publication start date filter.",
        }),
      ),
      search_before_date_filter: Type.Optional(
        Type.String({
          description: "Optional result publication end date filter.",
        }),
      ),
      last_updated_after_filter: Type.Optional(
        Type.String({
          description: "Optional page last-updated start date filter.",
        }),
      ),
      last_updated_before_filter: Type.Optional(
        Type.String({
          description: "Optional page last-updated end date filter.",
        }),
      ),
    }),
    execute: async (_toolCallId, params, signal) => {
      const queries = normalizeSearchQueries(params.query);
      const maxResults = normalizeMaxResults(params.max_results);
      const searchDomainFilter = normalizeSearchDomainFilter(params.search_domain_filter);
      const searchRecencyFilter = normalizeSearchRecencyFilter(params.search_recency_filter);
      const searchAfterDateFilter = normalizeOptionalString(
        params.search_after_date_filter,
        "search_after_date_filter",
      );
      const searchBeforeDateFilter = normalizeOptionalString(
        params.search_before_date_filter,
        "search_before_date_filter",
      );
      const lastUpdatedAfterFilter = normalizeOptionalString(
        params.last_updated_after_filter,
        "last_updated_after_filter",
      );
      const lastUpdatedBeforeFilter = normalizeOptionalString(
        params.last_updated_before_filter,
        "last_updated_before_filter",
      );

      const payload: SearchCreateParams = {
        query: queries.length === 1 ? queries[0] : queries,
        max_results: maxResults,
        max_tokens: DEFAULT_MAX_TOKENS,
        max_tokens_per_page: DEFAULT_MAX_TOKENS_PER_PAGE,
        search_language_filter: DEFAULT_SEARCH_LANGUAGE_FILTER,
        ...(searchDomainFilter ? { search_domain_filter: searchDomainFilter } : {}),
        ...(searchRecencyFilter ? { search_recency_filter: searchRecencyFilter } : {}),
        ...(searchAfterDateFilter ? { search_after_date_filter: searchAfterDateFilter } : {}),
        ...(searchBeforeDateFilter ? { search_before_date_filter: searchBeforeDateFilter } : {}),
        ...(lastUpdatedAfterFilter ? { last_updated_after_filter: lastUpdatedAfterFilter } : {}),
        ...(lastUpdatedBeforeFilter ? { last_updated_before_filter: lastUpdatedBeforeFilter } : {}),
      };

      const result = await getClient().search.create(payload, { signal });
      const resultGroups = normalizeSearchResultGroups(result.results);
      const resultCount = resultGroups.reduce((count, group) => count + group.length, 0);

      return {
        content: [
          {
            type: "text",
            text: formatSearchContext(queries, resultGroups),
          },
        ],
        details: {
          query: queries.length === 1 ? queries[0] : queries,
          queries,
          maxResults,
          searchDomainFilter,
          searchRecencyFilter,
          searchAfterDateFilter,
          searchBeforeDateFilter,
          lastUpdatedAfterFilter,
          lastUpdatedBeforeFilter,
          searchLanguageFilter: DEFAULT_SEARCH_LANGUAGE_FILTER,
          resultCount,
          responseId: result.id,
        },
      };
    },
    renderCall(args, theme, _context) {
      return new Text(
        theme.fg("toolTitle", theme.bold("web_search ")) +
          theme.fg("accent", `"${formatRenderArgument(args.query)}"`),
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Perplexity Web Fetch",
    description:
      "Fetch one or more specific HTTP(S) URLs provided by the user using Perplexity pro-search and return the fetched page context.",
    promptSnippet:
      "Fetch specific URLs with web_fetch when the user provides explicit URLs to read, inspect, check, or use as documentation/context.",
    promptGuidelines: [
      "Use this tool when the user provides one or more URLs and asks you to read, inspect, check, search at, or use those pages as context.",
      "Use web_search instead when the user asks to discover pages or search the web without a specific URL.",
      "Prefer web_fetch over web_search when the user gave exact URLs, unless fetching fails or additional sources are needed.",
      "If the user provides multiple URLs, pass them together in urls instead of calling web_fetch repeatedly.",
      "Only fetch URLs that the user provided or clearly asked you to open.",
    ],
    parameters: Type.Object({
      url: Type.Optional(
        Type.Union([
          Type.String({
            description: "Absolute http:// or https:// URL to fetch",
          }),
          Type.Array(Type.String(), {
            description: "Absolute http:// or https:// URLs to fetch",
            maxItems: MAX_FETCH_URLS,
          }),
        ]),
      ),
      urls: Type.Optional(
        Type.Array(Type.String(), {
          description: "Absolute http:// or https:// URLs to fetch in one request",
          maxItems: MAX_FETCH_URLS,
        }),
      ),
    }),
    execute: async (_toolCallId, params, signal) => {
      const urls = normalizeFetchUrls(params.url, params.urls);
      const requestedUrls = urls.map((url) => url.toString());

      const payload: ResponseCreateParamsNonStreaming = {
        preset: WEB_FETCH_PRESET,
        input: buildFetchInput(urls),
        max_steps: 1,
        tools: [{ type: "fetch_url", max_urls: urls.length }],
      };

      const result = await getClient().responses.create(payload, { signal });

      if (result.error) {
        throw new Error(`Perplexity web_fetch failed: ${result.error.message}`);
      }

      if (result.status !== "completed") {
        throw new Error(`Perplexity web_fetch ended with status ${result.status}`);
      }

      const fetchedContents = extractFetchedUrlContents(result);

      return {
        content: [
          {
            type: "text",
            text: formatFetchContext(requestedUrls, result, fetchedContents),
          },
        ],
        details: {
          url: requestedUrls[0],
          urls: requestedUrls,
          preset: WEB_FETCH_PRESET,
          responseId: result.id,
          model: result.model,
          status: result.status,
          fetchedUrls: fetchedContents.map((content) => content.url),
          usage: result.usage,
        },
      };
    },
    renderCall(args, theme, _context) {
      const fetchArgument = args.urls ?? args.url;
      return new Text(
        theme.fg("toolTitle", theme.bold("web_fetch ")) +
          theme.fg("accent", `"${formatRenderArgument(fetchArgument)}"`),
        0,
        0,
      );
    },
  });
}
