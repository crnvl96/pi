import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/v1/sonar";

const SONAR_MODELS = [
  "sonar",
  "sonar-pro",
  "sonar-deep-research",
  "sonar-reasoning-pro",
] as const;
const SEARCH_RECENCY_FILTERS = ["hour", "day", "week", "month", "year"] as const;
const SEARCH_MODES = ["web", "academic", "sec"] as const;
const SEARCH_CONTEXT_SIZES = ["low", "medium", "high"] as const;
const SEARCH_TYPES = ["fast", "pro", "auto"] as const;
const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;

const DEFAULT_MAX_SOURCES = 5;
const MAX_SOURCES = 20;
const DEFAULT_MAX_TOKENS = 1024;
const MAX_COMPLETION_TOKENS = 128000;
const DATE_FILTER_PATTERN = "^(0[1-9]|1[0-2])\\/(0[1-9]|[12][0-9]|3[01])\\/\\d{4}$";

type SonarModel = (typeof SONAR_MODELS)[number];
type SearchRecencyFilter = (typeof SEARCH_RECENCY_FILTERS)[number];
type SearchMode = (typeof SEARCH_MODES)[number];
type SearchContextSize = (typeof SEARCH_CONTEXT_SIZES)[number];
type SearchType = (typeof SEARCH_TYPES)[number];
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  date?: string | null;
  lastUpdated?: string | null;
  source?: string;
}

interface UsageCost {
  input_tokens_cost?: number;
  output_tokens_cost?: number;
  reasoning_tokens_cost?: number | null;
  request_cost?: number | null;
  citation_tokens_cost?: number | null;
  search_queries_cost?: number | null;
  total_cost?: number;
}

interface UsageInfo {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  search_context_size?: string | null;
  citation_tokens?: number | null;
  num_search_queries?: number | null;
  reasoning_tokens?: number | null;
  cost?: UsageCost;
}

interface UsageSummary {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  citationTokens?: number;
  reasoningTokens?: number;
  searchQueries?: number;
  totalCost?: number;
}

interface SearchResponse {
  id?: string;
  model?: string;
  answer: string;
  results: SearchResult[];
  relatedQuestions: string[];
  usage?: UsageInfo | null;
}

interface SearchOptions {
  maxSources?: number;
  model?: SonarModel;
  maxTokens?: number;
  recencyFilter?: SearchRecencyFilter;
  domainFilter?: string[];
  searchLanguageFilter?: string[];
  languagePreference?: string;
  searchMode?: SearchMode;
  searchContextSize?: SearchContextSize;
  searchType?: SearchType;
  searchAfterDateFilter?: string;
  searchBeforeDateFilter?: string;
  lastUpdatedAfterFilter?: string;
  lastUpdatedBeforeFilter?: string;
  country?: string;
  city?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  reasoningEffort?: ReasoningEffort;
  returnRelatedQuestions?: boolean;
  signal?: AbortSignal;
}

interface ApiPublicSearchResult {
  title?: string;
  url?: string;
  date?: string | null;
  last_updated?: string | null;
  snippet?: string;
  source?: string;
}

interface PerplexityApiResponse {
  id?: string;
  model?: string;
  usage?: UsageInfo | null;
  choices?: Array<{ message?: { content?: unknown } }>;
  citations?: string[] | null;
  search_results?: ApiPublicSearchResult[] | null;
  related_questions?: string[] | null;
}

const SearchParams = Type.Object({
  query: Type.Optional(
    Type.String({
      description: "Single general web research query.",
    }),
  ),
  queries: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Multiple general web research queries searched with up to 3 concurrent requests, with synthesized answers saved to the Markdown output file. Prefer this for broad research — vary phrasing, scope, and angle across 2-4 queries. Good: ['React vs Vue performance benchmarks 2026', 'React vs Vue developer experience comparison', 'React ecosystem size vs Vue ecosystem']. Bad: ['React vs Vue', 'React vs Vue comparison', 'React vs Vue review'] (too similar, redundant results).",
    }),
  ),
  maxSources: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_SOURCES,
      description: "Sources to display per query (default: 5, max: 20).",
    }),
  ),
  numResults: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_SOURCES,
      description: "Backward-compatible alias for maxSources.",
    }),
  ),
  model: Type.Optional(
    StringEnum(SONAR_MODELS, {
      description: "Perplexity Sonar model to use (default: sonar).",
    }),
  ),
  maxTokens: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_COMPLETION_TOKENS,
      description: "Maximum completion tokens to generate (default: 1024, max: 128000).",
    }),
  ),
  recencyFilter: Type.Optional(
    StringEnum(SEARCH_RECENCY_FILTERS, {
      description: "Filter by publication recency.",
    }),
  ),
  domainFilter: Type.Optional(
    Type.Array(Type.String({ maxLength: 253 }), {
      maxItems: 20,
      description: "Limit search results to specific domains, e.g. ['github.com', 'wikipedia.org']. Exclusion syntax is not supported by /v1/sonar.",
    }),
  ),
  searchLanguageFilter: Type.Optional(
    Type.Array(Type.String({ minLength: 2, maxLength: 2 }), {
      maxItems: 20,
      description: "Filter source results by ISO 639-1 language codes, e.g. ['en', 'fr'].",
    }),
  ),
  languagePreference: Type.Optional(
    Type.String({
      minLength: 2,
      maxLength: 2,
      description: "Preferred answer language as an ISO 639-1 code, e.g. 'en'.",
    }),
  ),
  searchMode: Type.Optional(
    StringEnum(SEARCH_MODES, {
      description: "Source of search results: web, academic, or sec.",
    }),
  ),
  searchContextSize: Type.Optional(
    StringEnum(SEARCH_CONTEXT_SIZES, {
      description: "Amount of search context to include: low, medium, or high.",
    }),
  ),
  searchType: Type.Optional(
    StringEnum(SEARCH_TYPES, {
      description: "Search type: fast for speed, pro for quality, or auto.",
    }),
  ),
  searchAfterDateFilter: Type.Optional(
    Type.String({
      pattern: DATE_FILTER_PATTERN,
      description: "Return results published after this date (MM/DD/YYYY).",
    }),
  ),
  searchBeforeDateFilter: Type.Optional(
    Type.String({
      pattern: DATE_FILTER_PATTERN,
      description: "Return results published before this date (MM/DD/YYYY).",
    }),
  ),
  lastUpdatedAfterFilter: Type.Optional(
    Type.String({
      pattern: DATE_FILTER_PATTERN,
      description: "Return results last updated after this date (MM/DD/YYYY).",
    }),
  ),
  lastUpdatedBeforeFilter: Type.Optional(
    Type.String({
      pattern: DATE_FILTER_PATTERN,
      description: "Return results last updated before this date (MM/DD/YYYY).",
    }),
  ),
  country: Type.Optional(
    Type.String({
      minLength: 2,
      maxLength: 2,
      description: "Optional ISO 3166-1 alpha-2 country code for search personalization.",
    }),
  ),
  city: Type.Optional(Type.String({ description: "Optional city for search personalization." })),
  region: Type.Optional(Type.String({ description: "Optional region/state for search personalization." })),
  latitude: Type.Optional(
    Type.Number({ minimum: -90, maximum: 90, description: "Optional latitude for search personalization." }),
  ),
  longitude: Type.Optional(
    Type.Number({ minimum: -180, maximum: 180, description: "Optional longitude for search personalization." }),
  ),
  reasoningEffort: Type.Optional(
    StringEnum(REASONING_EFFORTS, {
      description: "Reasoning effort for reasoning-capable models.",
    }),
  ),
  returnRelatedQuestions: Type.Optional(
    Type.Boolean({ description: "Include Perplexity related follow-up questions in the output." }),
  ),
});

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getApiKey(): string {
  const key = normalizeApiKey(process.env["PERPLEXITY_API_KEY"]);
  if (!key) {
    throw new Error(
      "Perplexity API key not found. Set PERPLEXITY_API_KEY environment variable.\n" +
        "Get a key at https://perplexity.ai/settings/api",
    );
  }
  return key;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeDomainFilter(domains: string[]): string[] {
  const normalized: string[] = [];
  for (const value of domains) {
    const domain = value.trim();
    if (!domain) continue;
    if (domain.startsWith("-")) {
      throw new Error(
        `Domain exclusions are not supported by Perplexity /v1/sonar: ${domain}. Use positive domain filters only.`,
      );
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/.test(domain)) {
      throw new Error(`Invalid domain filter: ${domain}`);
    }
    normalized.push(domain);
  }
  return normalized.slice(0, 20);
}

function normalizeLanguageCodes(values: string[], label: string): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    const code = value.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) throw new Error(`Invalid ${label}: ${value}`);
    normalized.push(code);
  }
  return normalized.slice(0, 20);
}

function normalizeLanguageCode(value: string, label: string): string {
  const code = value.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) throw new Error(`Invalid ${label}: ${value}`);
  return code;
}

function normalizeCountryCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new Error(`Invalid country code: ${value}`);
  return code;
}

function normalizeDateFilter(value: string, label: string): string {
  const date = value.trim();
  if (!new RegExp(DATE_FILTER_PATTERN).test(date)) {
    throw new Error(`Invalid ${label}: ${value}. Expected MM/DD/YYYY.`);
  }
  return date;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((chunk) => {
      if (!chunk || typeof chunk !== "object") return "";
      const type = "type" in chunk ? chunk.type : undefined;
      const text = "text" in chunk ? chunk.text : undefined;
      return type === "text" && typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildWebSearchOptions(options: SearchOptions): Record<string, unknown> | undefined {
  const webSearchOptions: Record<string, unknown> = {};
  if (options.searchContextSize) webSearchOptions["search_context_size"] = options.searchContextSize;
  if (options.searchType) webSearchOptions["search_type"] = options.searchType;

  const userLocation: Record<string, unknown> = {};
  if (options.country) userLocation["country"] = normalizeCountryCode(options.country);
  if (options.city) userLocation["city"] = options.city;
  if (options.region) userLocation["region"] = options.region;
  if (typeof options.latitude === "number") userLocation["latitude"] = options.latitude;
  if (typeof options.longitude === "number") userLocation["longitude"] = options.longitude;
  if (Object.keys(userLocation).length > 0) webSearchOptions["user_location"] = userLocation;

  return Object.keys(webSearchOptions).length > 0 ? webSearchOptions : undefined;
}

function addSearchResult(
  results: SearchResult[],
  seenUrls: Set<string>,
  result: SearchResult,
  maxSources: number,
): void {
  if (results.length >= maxSources) return;
  if (!result.url || seenUrls.has(result.url)) return;
  seenUrls.add(result.url);
  results.push(result);
}

function buildSearchResults(
  searchResults: ApiPublicSearchResult[],
  citations: string[],
  maxSources: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const result of searchResults) {
    if (typeof result.url !== "string" || !result.url.trim()) continue;
    const title = typeof result.title === "string" && result.title.trim() ? result.title.trim() : result.url;
    const snippet = typeof result.snippet === "string" ? normalizeWhitespace(result.snippet) : "";

    addSearchResult(
      results,
      seenUrls,
      {
        title,
        url: result.url,
        ...(snippet ? { snippet } : {}),
        ...(result.date !== undefined ? { date: result.date } : {}),
        ...(result.last_updated !== undefined ? { lastUpdated: result.last_updated } : {}),
        ...(result.source ? { source: result.source } : {}),
      },
      maxSources,
    );
  }

  for (const citation of citations) {
    if (typeof citation !== "string" || !citation.trim()) continue;
    addSearchResult(
      results,
      seenUrls,
      { title: `Source ${results.length + 1}`, url: citation.trim() },
      maxSources,
    );
  }

  return results;
}

async function searchWithPerplexity(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const apiKey = getApiKey();
  const maxSources = clampInteger(options.maxSources ?? DEFAULT_MAX_SOURCES, 1, MAX_SOURCES);

  const requestBody: Record<string, unknown> = {
    model: options.model ?? "sonar",
    messages: [{ role: "user", content: query }],
    max_tokens: clampInteger(options.maxTokens ?? DEFAULT_MAX_TOKENS, 1, MAX_COMPLETION_TOKENS),
    return_related_questions: options.returnRelatedQuestions ?? false,
  };

  if (options.searchMode) requestBody["search_mode"] = options.searchMode;
  if (options.recencyFilter) requestBody["search_recency_filter"] = options.recencyFilter;
  if (options.reasoningEffort) requestBody["reasoning_effort"] = options.reasoningEffort;
  if (options.languagePreference) {
    requestBody["language_preference"] = normalizeLanguageCode(
      options.languagePreference,
      "languagePreference",
    );
  }

  if (options.domainFilter && options.domainFilter.length > 0) {
    const normalized = normalizeDomainFilter(options.domainFilter);
    if (normalized.length > 0) requestBody["search_domain_filter"] = normalized;
  }

  if (options.searchLanguageFilter && options.searchLanguageFilter.length > 0) {
    const normalized = normalizeLanguageCodes(options.searchLanguageFilter, "searchLanguageFilter");
    if (normalized.length > 0) requestBody["search_language_filter"] = normalized;
  }

  if (options.searchAfterDateFilter) {
    requestBody["search_after_date_filter"] = normalizeDateFilter(
      options.searchAfterDateFilter,
      "searchAfterDateFilter",
    );
  }
  if (options.searchBeforeDateFilter) {
    requestBody["search_before_date_filter"] = normalizeDateFilter(
      options.searchBeforeDateFilter,
      "searchBeforeDateFilter",
    );
  }
  if (options.lastUpdatedAfterFilter) {
    requestBody["last_updated_after_filter"] = normalizeDateFilter(
      options.lastUpdatedAfterFilter,
      "lastUpdatedAfterFilter",
    );
  }
  if (options.lastUpdatedBeforeFilter) {
    requestBody["last_updated_before_filter"] = normalizeDateFilter(
      options.lastUpdatedBeforeFilter,
      "lastUpdatedBeforeFilter",
    );
  }

  const webSearchOptions = buildWebSearchOptions(options);
  if (webSearchOptions) requestBody["web_search_options"] = webSearchOptions;

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

  const answer = extractMessageContent(data.choices?.[0]?.message?.content).trim();
  const searchResults = Array.isArray(data.search_results) ? data.search_results : [];
  const citations = Array.isArray(data.citations) ? data.citations : [];
  const results = buildSearchResults(searchResults, citations, maxSources);
  const relatedQuestions = Array.isArray(data.related_questions)
    ? data.related_questions.filter((q): q is string => typeof q === "string" && q.trim() !== "")
    : [];

  return {
    id: data.id,
    model: data.model,
    answer,
    results,
    relatedQuestions,
    usage: data.usage ?? null,
  };
}

interface QueryResultData {
  query: string;
  id?: string;
  model?: string;
  answer: string;
  results: SearchResult[];
  relatedQuestions: string[];
  usage?: UsageInfo | null;
  error: string | null;
}

interface PerplexityWebSearchDetails {
  queryCount?: number;
  successfulQueries?: number;
  failedQueries?: number;
  totalResults?: number;
  usage?: UsageSummary;
  error?: string;
  phase?: string;
  progress?: number;
  completed?: number;
  total?: number;
  fullOutputPath?: string;
  truncation?: TruncationResult;
}

const CONCURRENCY_LIMIT = 3;
const OUTPUT_DIR = "/tmp";

function normalizeQueryList(queryList: unknown[]): string[] {
  const normalized: string[] = [];
  for (const query of queryList) {
    if (typeof query !== "string") continue;
    const trimmed = query.trim();
    if (trimmed.length > 0) normalized.push(trimmed);
  }
  return normalized;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex++;
      if (index >= items.length) return;

      const item = items[index] as T;
      results[index] = await worker(item, index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function formatSource(result: SearchResult, index: number): string {
  const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];
  const metadata: string[] = [];
  if (result.date) metadata.push(`published: ${result.date}`);
  if (result.lastUpdated) metadata.push(`updated: ${result.lastUpdated}`);
  if (result.source && result.source !== "web") metadata.push(`source: ${result.source}`);
  if (metadata.length > 0) lines.push(`   ${metadata.join(" • ")}`);
  if (result.snippet) lines.push(`   Snippet: ${result.snippet}`);
  return lines.join("\n");
}

function formatSearchSummary(
  results: SearchResult[],
  answer: string,
  relatedQuestions: string[],
): string {
  let output = answer.trim();

  if (results.length > 0) {
    if (output) output += "\n\n---\n\n";
    output += "**Sources:**\n";
    output += results.map((result, i) => formatSource(result, i)).join("\n\n");
  }

  if (relatedQuestions.length > 0) {
    if (output) output += "\n\n";
    output += "**Related questions:**\n";
    output += relatedQuestions.map((question, i) => `${i + 1}. ${question}`).join("\n");
  }

  return output;
}

function formatSearchItem(result: QueryResultData, includeHeader: boolean): string {
  let output = includeHeader ? `## Query: "${result.query}"\n\n` : "";

  if (result.error) output += `Error: ${result.error}`;
  else if (!result.answer && result.results.length === 0) output += "No answer or sources returned.";
  else output += formatSearchSummary(result.results, result.answer, result.relatedQuestions);

  return output.trim();
}

function buildSearchOutput(results: QueryResultData[]): string {
  const includeHeader = results.length > 1;
  return results
    .map((result) => formatSearchItem(result, includeHeader))
    .join("\n\n")
    .trim();
}

async function saveMarkdownOutput(fullContent: string): Promise<string> {
  const path = join(OUTPUT_DIR, `perplexity-web-search-${Date.now()}-${randomUUID()}.md`);
  await writeFile(path, fullContent, "utf8");
  return path;
}

function buildSearchOptions(
  params: {
    maxSources?: number;
    numResults?: number;
    model?: SonarModel;
    maxTokens?: number;
    recencyFilter?: SearchRecencyFilter;
    domainFilter?: string[];
    searchLanguageFilter?: string[];
    languagePreference?: string;
    searchMode?: SearchMode;
    searchContextSize?: SearchContextSize;
    searchType?: SearchType;
    searchAfterDateFilter?: string;
    searchBeforeDateFilter?: string;
    lastUpdatedAfterFilter?: string;
    lastUpdatedBeforeFilter?: string;
    country?: string;
    city?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    reasoningEffort?: ReasoningEffort;
    returnRelatedQuestions?: boolean;
  },
  signal: AbortSignal | undefined,
): SearchOptions {
  const options: SearchOptions = {};
  if (typeof params.maxSources === "number") options.maxSources = params.maxSources;
  else if (typeof params.numResults === "number") options.maxSources = params.numResults;
  if (params.model) options.model = params.model;
  if (typeof params.maxTokens === "number") options.maxTokens = params.maxTokens;
  if (params.recencyFilter) options.recencyFilter = params.recencyFilter;
  if (params.domainFilter) options.domainFilter = params.domainFilter;
  if (params.searchLanguageFilter) options.searchLanguageFilter = params.searchLanguageFilter;
  if (params.languagePreference) options.languagePreference = params.languagePreference;
  if (params.searchMode) options.searchMode = params.searchMode;
  if (params.searchContextSize) options.searchContextSize = params.searchContextSize;
  if (params.searchType) options.searchType = params.searchType;
  if (params.searchAfterDateFilter) options.searchAfterDateFilter = params.searchAfterDateFilter;
  if (params.searchBeforeDateFilter) options.searchBeforeDateFilter = params.searchBeforeDateFilter;
  if (params.lastUpdatedAfterFilter) options.lastUpdatedAfterFilter = params.lastUpdatedAfterFilter;
  if (params.lastUpdatedBeforeFilter) options.lastUpdatedBeforeFilter = params.lastUpdatedBeforeFilter;
  if (params.country) options.country = params.country;
  if (params.city) options.city = params.city;
  if (params.region) options.region = params.region;
  if (typeof params.latitude === "number") options.latitude = params.latitude;
  if (typeof params.longitude === "number") options.longitude = params.longitude;
  if (params.reasoningEffort) options.reasoningEffort = params.reasoningEffort;
  if (typeof params.returnRelatedQuestions === "boolean") {
    options.returnRelatedQuestions = params.returnRelatedQuestions;
  }
  if (signal) options.signal = signal;
  return options;
}

function addUsageValue(
  summary: UsageSummary,
  key: keyof UsageSummary,
  value: number | null | undefined,
): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  summary[key] = (summary[key] ?? 0) + value;
  return true;
}

function aggregateUsage(results: QueryResultData[]): UsageSummary | undefined {
  const summary: UsageSummary = {};
  let hasUsage = false;

  for (const result of results) {
    const usage = result.usage;
    if (!usage) continue;
    hasUsage = addUsageValue(summary, "promptTokens", usage.prompt_tokens) || hasUsage;
    hasUsage = addUsageValue(summary, "completionTokens", usage.completion_tokens) || hasUsage;
    hasUsage = addUsageValue(summary, "totalTokens", usage.total_tokens) || hasUsage;
    hasUsage = addUsageValue(summary, "citationTokens", usage.citation_tokens) || hasUsage;
    hasUsage = addUsageValue(summary, "reasoningTokens", usage.reasoning_tokens) || hasUsage;
    hasUsage = addUsageValue(summary, "searchQueries", usage.num_search_queries) || hasUsage;
    hasUsage = addUsageValue(summary, "totalCost", usage.cost?.total_cost) || hasUsage;
  }

  return hasUsage ? summary : undefined;
}

function buildDetails(
  results: QueryResultData[],
  outputPath: string,
  truncation: TruncationResult,
): PerplexityWebSearchDetails {
  const successfulQueries = results.filter((r) => !r.error).length;
  const failedQueries = results.length - successfulQueries;
  const usage = aggregateUsage(results);
  return {
    fullOutputPath: outputPath,
    ...(truncation.truncated ? { truncation } : {}),
    queryCount: results.length,
    successfulQueries,
    failedQueries,
    totalResults: results.reduce((sum, r) => sum + r.results.length, 0),
    ...(usage ? { usage } : {}),
  };
}

export default function PerplexityWebAccess(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "perplexity-web-search",
    label: "Perplexity Web Search",
    description:
      `Search and synthesize current web, academic, or SEC information using Perplexity Sonar (/v1/sonar). Returns a truncated preview limited to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first), and saves the full Markdown output with sources to /tmp. Multiple queries run with up to 3 concurrent requests.`,
    promptSnippet:
      "Use for general/current web research, news, comparisons, academic or SEC lookups, and broad facts. Prefer {queries:[...]} with 2-4 varied angles. The response includes a synthesized answer, sources, and the full Markdown output path.",
    parameters: SearchParams,

    async execute(_toolCallId, params, signal, onUpdate) {
      const rawQueryList: unknown[] = Array.isArray(params.queries)
        ? params.queries
        : params.query !== undefined
          ? [params.query]
          : [];
      const queryList = normalizeQueryList(rawQueryList);

      if (queryList.length === 0) {
        return {
          content: [
            { type: "text", text: "Error: No query provided. Use 'query' or 'queries' parameter." },
          ],
          details: { error: "No query provided" } satisfies PerplexityWebSearchDetails,
        };
      }

      const options = buildSearchOptions(params, signal);
      let completed = 0;

      onUpdate?.({
        content: [{ type: "text", text: `Searching 0/${queryList.length} queries...` }],
        details: { phase: "search", progress: 0, completed, total: queryList.length },
      });

      const searchResults = await runWithConcurrency(
        queryList,
        CONCURRENCY_LIMIT,
        async (query): Promise<QueryResultData> => {
          try {
            const { id, model, answer, results, relatedQuestions, usage } = await searchWithPerplexity(
              query,
              options,
            );
            return { query, id, model, answer, results, relatedQuestions, usage, error: null };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { query, answer: "", results: [], relatedQuestions: [], error: message };
          } finally {
            completed++;
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: `Searched ${completed}/${queryList.length}: "${query}"`,
                },
              ],
              details: {
                phase: "search",
                progress: completed / queryList.length,
                completed,
                total: queryList.length,
              },
            });
          }
        },
      );

      const fullOutput = buildSearchOutput(searchResults);
      const outputPath = await saveMarkdownOutput(fullOutput);
      const truncation = truncateHead(fullOutput, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let resultText = truncation.content;
      if (truncation.truncated) {
        const truncatedLines = truncation.totalLines - truncation.outputLines;
        const truncatedBytes = truncation.totalBytes - truncation.outputBytes;

        resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
        resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
        resultText += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
        resultText += ` Full output saved to: ${outputPath}]`;
      } else {
        resultText += `\n\n[Full output saved to: ${outputPath}]`;
      }

      return {
        content: [{ type: "text", text: resultText }],
        details: buildDetails(searchResults, outputPath, truncation),
      };
    },

    renderCall(args, theme) {
      const rawQueryList: unknown[] = Array.isArray(args.queries)
        ? args.queries
        : args.query !== undefined
          ? [args.query]
          : [];
      const queryList = normalizeQueryList(rawQueryList);
      const model = typeof args.model === "string" && args.model !== "sonar" ? ` ${args.model}` : "";
      if (queryList.length === 0) {
        return new Text(
          theme.fg("toolTitle", theme.bold("perplexity search ")) + theme.fg("error", "(no query)"),
          0,
          0,
        );
      }
      if (queryList.length === 1) {
        const query = queryList[0] ?? "";
        const display = query.length > 60 ? query.slice(0, 57) + "..." : query;
        return new Text(
          theme.fg("toolTitle", theme.bold("perplexity search ")) +
            theme.fg("accent", `"${display}"`) +
            theme.fg("dim", model),
          0,
          0,
        );
      }

      const lines = [
        theme.fg("toolTitle", theme.bold("perplexity search ")) +
          theme.fg("accent", `${queryList.length} queries`) +
          theme.fg("dim", model),
      ];
      for (const query of queryList.slice(0, 5)) {
        const display = query.length > 50 ? query.slice(0, 47) + "..." : query;
        lines.push(theme.fg("muted", `  "${display}"`));
      }
      if (queryList.length > 5) {
        lines.push(theme.fg("muted", `  ... and ${queryList.length - 5} more`));
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    renderResult(result, { isPartial }, theme) {
      const details = result.details as PerplexityWebSearchDetails | undefined;

      if (isPartial) {
        const progress = details?.progress ?? 0;
        const bar =
          "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
        const count =
          details?.completed !== undefined && details?.total !== undefined
            ? `${details.completed}/${details.total}`
            : details?.phase || "searching";
        return new Text(theme.fg("accent", `[${bar}] ${count}`), 0, 0);
      }

      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      const queryInfo =
        details?.queryCount === 1
          ? ""
          : `${details?.successfulQueries}/${details?.queryCount} queries, `;
      const failedQueries = details?.failedQueries ?? 0;
      const baseStatus = `${queryInfo}${details?.totalResults ?? 0} sources`;
      let statusLine =
        failedQueries > 0
          ? theme.fg("warning", `${baseStatus}, ${failedQueries} failed`)
          : theme.fg("success", baseStatus);

      const usageParts: string[] = [];
      if (details?.usage?.totalTokens !== undefined) usageParts.push(`${details.usage.totalTokens} tokens`);
      if (details?.usage?.searchQueries !== undefined) {
        usageParts.push(`${details.usage.searchQueries} searches`);
      }
      if (details?.usage?.totalCost !== undefined) {
        usageParts.push(`$${details.usage.totalCost.toFixed(4)}`);
      }
      if (usageParts.length > 0) statusLine += theme.fg("dim", ` (${usageParts.join(", ")})`);

      if (details?.truncation?.truncated) {
        statusLine += theme.fg("warning", " (truncated)");
      }

      const outputPath = details?.fullOutputPath || "";
      const pathLine = outputPath ? theme.fg("dim", outputPath) : theme.fg("dim", "No output file");

      return new Text(statusLine + "\n" + pathLine, 0, 0);
    },
  });
}
