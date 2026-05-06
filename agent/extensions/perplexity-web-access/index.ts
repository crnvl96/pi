import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
  type QueryResultData,
  type SearchResult,
  type FetchOptions,
  type SearchOptions,
  type StoredMetadataDetails,
  type PerplexityWebSearchDetails,
} from "./types.js";
import { fetchUrlWithPerplexity, searchWithPerplexity } from "./perplexity.js";

const CONCURRENCY_LIMIT = 3;
const MAX_INLINE_CONTENT = 30_000;
const MAX_STORED_BYTES = 10 * 1024 * 1024;
const CACHE_STATUS_ID = "perplexity-cache";

interface FetchResultData {
  url: string;
  content: string;
  results: SearchResult[];
  error: string | null;
}

interface PerplexityWebFetchDetails extends StoredMetadataDetails {
  urls?: string[];
  urlCount?: number;
  successful?: number;
  totalSources?: number;
  error?: string;
  phase?: string;
  progress?: number;
  completed?: number;
  total?: number;
  currentUrl?: string;
  urlResults?: Array<{
    url: string;
    content: string | null;
    sources: Array<{ title: string; url: string }>;
    error: string | null;
  }>;
}

interface PerplexityCodeSearchDetails extends StoredMetadataDetails {
  query?: string;
  enhancedQuery?: string;
  totalResults?: number;
  error?: string;
}

interface PerplexityGetContentDetails {
  responseId?: string;
  type?: StoredContentType;
  itemKind?: StoredItemKind;
  itemCount?: number;
  selectedIndex?: number;
  byteSize?: number;
  cacheBytes?: number;
  cacheMaxBytes?: number;
  error?: string;
}

type StoredContentType = "search" | "fetch" | "code-search";
type StoredItemKind = "query" | "url";

interface StoredContentItem {
  label: string;
  content: string;
}

interface StoredContentEntry {
  responseId: string;
  type: StoredContentType;
  itemKind: StoredItemKind;
  createdAt: number;
  byteSize: number;
  items: StoredContentItem[];
}

interface StoredContentResult {
  responseId: string;
  byteSize: number;
  fullContent: string;
}

interface PreparedOutput {
  text: string;
  truncated: boolean;
}

const storedContent = new Map<string, StoredContentEntry>();
let storedBytes = 0;
let activeContext: ExtensionContext | null = null;

const SearchParams = Type.Object({
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

const FetchParams = Type.Object({
  url: Type.Optional(Type.String({ description: "Single HTTP/HTTPS URL to read or summarize" })),
  urls: Type.Optional(
    Type.Array(Type.String(), {
      description: "Multiple HTTP/HTTPS URLs to read or summarize with up to 3 concurrent requests",
    }),
  ),
  prompt: Type.Optional(
    Type.String({
      description:
        "Question or instruction for extraction from the provided URL(s). Pass the user's specific question here when they ask about a particular aspect of the page.",
    }),
  ),
});

const CodeSearchParams = Type.Object({
  query: Type.String({
    description:
      "Programming/API/library/framework/docs/source-code question. Do not use for specific URLs; use perplexity-web-fetch when a URL is provided.",
  }),
  numResults: Type.Optional(
    Type.Number({ description: "Sources to return (default: 5, max: 20)" }),
  ),
});

const GetContentParams = Type.Object({
  responseId: Type.String({
    description: "The responseId returned by a Perplexity web access tool",
  }),
  queryIndex: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Retrieve a specific stored query/code-search item by zero-based index",
    }),
  ),
  urlIndex: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Retrieve a specific stored fetch URL by zero-based index",
    }),
  ),
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function updateCacheStatus(ctx: ExtensionContext | null | undefined): void {
  if (!ctx) return;
  const ratio = storedBytes / MAX_STORED_BYTES;
  const label = `Perplexity cache: ${formatBytes(storedBytes)} / ${formatBytes(MAX_STORED_BYTES)}`;
  const color = ratio >= 0.8 ? "warning" : storedBytes > 0 ? "accent" : "dim";
  ctx.ui.setStatus(CACHE_STATUS_ID, ctx.ui.theme.fg(color, label));
}

function clearStoredContent(ctx: ExtensionContext | null | undefined = activeContext): void {
  storedContent.clear();
  storedBytes = 0;
  updateCacheStatus(ctx);
}

function joinStoredItems(items: StoredContentItem[]): string {
  return items
    .map((item) => item.content)
    .join("\n\n")
    .trim();
}

function evictStoredContentIfNeeded(): void {
  while (storedBytes > MAX_STORED_BYTES && storedContent.size > 1) {
    const oldestId = storedContent.keys().next().value;
    if (typeof oldestId !== "string") return;

    const oldest = storedContent.get(oldestId);
    storedContent.delete(oldestId);
    if (oldest) storedBytes -= oldest.byteSize;
  }

  if (storedBytes < 0) storedBytes = 0;
}

function storeFullContent(
  type: StoredContentType,
  itemKind: StoredItemKind,
  items: StoredContentItem[],
  ctx: ExtensionContext | null | undefined,
): StoredContentResult {
  const fullContent = joinStoredItems(items);
  const byteSize = Buffer.byteLength(fullContent, "utf8");
  const responseId = randomUUID();

  storedContent.set(responseId, {
    responseId,
    type,
    itemKind,
    createdAt: Date.now(),
    byteSize,
    items,
  });
  storedBytes += byteSize;

  evictStoredContentIfNeeded();
  updateCacheStatus(ctx ?? activeContext);

  return { responseId, byteSize, fullContent };
}

function buildRetrievalHint(
  responseId: string,
  itemKind: StoredItemKind,
  itemCount: number,
): string {
  if (itemCount === 1) {
    const indexName = itemKind === "url" ? "urlIndex" : "queryIndex";
    return `Use perplexity-web-get-content({ responseId: "${responseId}", ${indexName}: 0 }) for the full content.`;
  }

  const indexName = itemKind === "url" ? "urlIndex" : "queryIndex";
  return `Use perplexity-web-get-content({ responseId: "${responseId}" }) for the full response, or add ${indexName} to retrieve one item.`;
}

function prepareOutput(
  fullContent: string,
  responseId: string,
  itemKind: StoredItemKind,
  itemCount: number,
): PreparedOutput {
  if (fullContent.length <= MAX_INLINE_CONTENT) return { text: fullContent, truncated: false };

  return {
    text:
      fullContent.slice(0, MAX_INLINE_CONTENT).trimEnd() +
      `\n\n[Content truncated...] ${buildRetrievalHint(responseId, itemKind, itemCount)}`,
    truncated: true,
  };
}

function withStoredMetadata<T extends StoredMetadataDetails>(
  details: T,
  stored: StoredContentResult,
  prepared: PreparedOutput,
): T {
  details.responseId = stored.responseId;
  details.truncated = prepared.truncated;
  details.fullLength = stored.fullContent.length;
  details.byteSize = stored.byteSize;
  details.cacheBytes = storedBytes;
  details.cacheMaxBytes = MAX_STORED_BYTES;
  return details;
}

function normalizeQueryList(queryList: unknown[]): string[] {
  const normalized: string[] = [];
  for (const query of queryList) {
    if (typeof query !== "string") continue;
    const trimmed = query.trim();
    if (trimmed.length > 0) normalized.push(trimmed);
  }
  return normalized;
}

function normalizeUrlList(urlList: unknown[]): string[] {
  const normalized: string[] = [];
  for (const url of urlList) {
    if (typeof url !== "string") continue;
    const trimmed = url.trim();
    if (trimmed.length === 0) continue;

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        normalized.push(trimmed);
      }
    } catch {
      // Ignore invalid URLs. The caller returns a clear error when none remain.
    }
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

function formatSearchSummary(results: SearchResult[], answer: string): string {
  let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
  output += results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
  return output;
}

function formatSearchItem(
  query: string,
  result: QueryResultData,
  includeHeader: boolean,
  headerLabel = "Query",
): string {
  let output = includeHeader ? `## ${headerLabel}: "${query}"\n\n` : "";

  if (result.error) output += `Error: ${result.error}`;
  else if (result.results.length === 0) output += "No results found.";
  else output += formatSearchSummary(result.results, result.answer);

  return output.trim();
}

function buildSearchItems(queryList: string[], results: QueryResultData[]): StoredContentItem[] {
  const includeHeader = queryList.length > 1;
  return results.map((result) => ({
    label: result.query,
    content: formatSearchItem(result.query, result, includeHeader),
  }));
}

function buildSearchOptions(
  params: {
    numResults?: number;
    recencyFilter?: "day" | "week" | "month" | "year";
    domainFilter?: string[];
  },
  signal: AbortSignal | undefined,
): SearchOptions {
  const options: SearchOptions = {};
  if (typeof params.numResults === "number") options.numResults = params.numResults;
  if (params.recencyFilter) options.recencyFilter = params.recencyFilter;
  if (params.domainFilter) options.domainFilter = params.domainFilter;
  if (signal) options.signal = signal;
  return options;
}

function buildDetails(queryList: string[], results: QueryResultData[]): PerplexityWebSearchDetails {
  return {
    queries: queryList,
    queryCount: queryList.length,
    successfulQueries: results.filter((r) => !r.error).length,
    totalResults: results.reduce((sum, r) => sum + r.results.length, 0),
    queryResults: results.map((r) => ({
      query: r.query,
      answer: r.error ? null : r.answer,
      sources: r.results.map((source) => ({ title: source.title, url: source.url })),
      error: r.error,
    })),
  };
}

function formatContentWithSources(content: string, sources: SearchResult[]): string {
  let output = content;
  if (sources.length > 0) {
    output += `${output ? "\n\n---\n\n" : ""}**Sources:**\n`;
    output += sources
      .map((source, i) => `${i + 1}. ${source.title}\n   ${source.url}`)
      .join("\n\n");
  }
  return output;
}

function formatFetchItem(url: string, result: FetchResultData, includeHeader: boolean): string {
  let output = includeHeader ? `## URL: ${url}\n\n` : "";

  if (result.error) output += `Error: ${result.error}`;
  else if (!result.content && result.results.length === 0) output += "No content found.";
  else output += formatContentWithSources(result.content, result.results);

  return output.trim();
}

function buildFetchItems(urlList: string[], results: FetchResultData[]): StoredContentItem[] {
  const includeHeader = urlList.length > 1;
  return results.map((result) => ({
    label: result.url,
    content: formatFetchItem(result.url, result, includeHeader),
  }));
}

function buildFetchOptions(
  prompt: string | undefined,
  signal: AbortSignal | undefined,
): FetchOptions {
  const options: FetchOptions = {};
  const normalizedPrompt = prompt?.trim();
  if (normalizedPrompt) options.prompt = normalizedPrompt;
  if (signal) options.signal = signal;
  return options;
}

function buildFetchDetails(
  urlList: string[],
  results: FetchResultData[],
): PerplexityWebFetchDetails {
  return {
    urls: urlList,
    urlCount: urlList.length,
    successful: results.filter((r) => !r.error).length,
    totalSources: results.reduce((sum, r) => sum + r.results.length, 0),
    urlResults: results.map((r) => ({
      url: r.url,
      content: r.error ? null : r.content,
      sources: r.results.map((source) => ({ title: source.title, url: source.url })),
      error: r.error,
    })),
  };
}

function buildCodeSearchQuery(query: string): string {
  const normalized = query.toLowerCase();
  const hasCodeTerms =
    /\b(api|code|docs?|documentation|example|examples|github|implementation|library|framework|package|sdk|source|stackoverflow|stack overflow)\b/.test(
      normalized,
    );
  return hasCodeTerms
    ? query
    : `${query} code examples documentation GitHub Stack Overflow official docs`;
}

function buildCodeSearchOptions(
  numResults: number | undefined,
  signal: AbortSignal | undefined,
): SearchOptions {
  const options: SearchOptions = {};
  if (typeof numResults === "number") options.numResults = numResults;
  if (signal) options.signal = signal;
  return options;
}

function buildCodeSearchItem(
  query: string,
  enhancedQuery: string,
  result: QueryResultData,
): StoredContentItem {
  let content = formatSearchItem(query, result, true, "Code/docs search");
  if (enhancedQuery !== query) {
    content += `\n\n---\n\nEnhanced query: ${enhancedQuery}`;
  }
  return { label: query, content };
}

function getContentPreview(text: string, expanded: boolean): string {
  const maxLength = expanded ? 500 : 120;
  return text.length > maxLength ? text.slice(0, maxLength - 3) + "..." : text;
}

function appendStoredStatus(
  statusLine: string,
  details: StoredMetadataDetails | undefined,
  theme: Theme,
): string {
  let output = statusLine;
  if (details?.truncated) output += theme.fg("warning", " [truncated]");
  if (details?.responseId) output += theme.fg("muted", ` [${details.responseId.slice(0, 8)}]`);
  if (details?.cacheBytes !== undefined && details.cacheMaxBytes !== undefined) {
    output += theme.fg(
      "muted",
      ` cache ${formatBytes(details.cacheBytes)}/${formatBytes(details.cacheMaxBytes)}`,
    );
  }
  return output;
}

function getValidIndex(value: number | undefined): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function buildGetContentErrorDetails(
  responseId: string,
  error: string,
): PerplexityGetContentDetails {
  return {
    responseId,
    error,
    cacheBytes: storedBytes,
    cacheMaxBytes: MAX_STORED_BYTES,
  };
}

export default function PerplexityWebAccess(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    activeContext = ctx;
    clearStoredContent(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    activeContext = ctx;
    updateCacheStatus(ctx);
  });

  pi.on("session_shutdown", () => {
    clearStoredContent(activeContext);
    activeContext?.ui.setStatus(CACHE_STATUS_ID, undefined);
    activeContext = null;
  });

  pi.registerTool({
    name: "perplexity-web-search",
    label: "Perplexity Web Search",
    description:
      "Search the general web using Perplexity AI for current facts, news, comparisons, and broad research. Returns synthesized answers with citations. Do not use for specific URL reading (use perplexity-web-fetch) or programming/API/docs/code-example questions without a URL (use perplexity-code-search). Multiple queries run with up to 3 concurrent requests.",
    promptSnippet:
      "Use for general/current web research, news, comparisons, and broad facts. Prefer {queries:[...]} with 2-4 varied angles. Use fetch for specific URLs and code-search for programming/docs/examples.",
    parameters: SearchParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
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
            const { answer, results } = await searchWithPerplexity(query, options);
            return { query, answer, results, error: null };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { query, answer: "", results: [], error: message };
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
                currentQuery: query,
              },
            });
          }
        },
      );

      const items = buildSearchItems(queryList, searchResults);
      const stored = storeFullContent("search", "query", items, ctx);
      const prepared = prepareOutput(stored.fullContent, stored.responseId, "query", items.length);
      const details = withStoredMetadata(buildDetails(queryList, searchResults), stored, prepared);

      return {
        content: [{ type: "text", text: prepared.text }],
        details,
      };
    },

    renderCall(args, theme) {
      const rawQueryList: unknown[] = Array.isArray(args.queries)
        ? args.queries
        : args.query !== undefined
          ? [args.query]
          : [];
      const queryList = normalizeQueryList(rawQueryList);
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
            theme.fg("accent", `"${display}"`),
          0,
          0,
        );
      }

      const lines = [
        theme.fg("toolTitle", theme.bold("perplexity search ")) +
          theme.fg("accent", `${queryList.length} queries`),
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

    renderResult(result, { expanded, isPartial }, theme) {
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
      const baseStatus = theme.fg("success", `${queryInfo}${details?.totalResults ?? 0} sources`);
      const statusLine = appendStoredStatus(baseStatus, details, theme);
      const textContent = result.content.find((c) => c.type === "text")?.text || "";

      if (!expanded) {
        const firstContentLine = textContent.split("\n").find((line) => {
          const trimmed = line.trim();
          return (
            trimmed &&
            !trimmed.startsWith("[") &&
            !trimmed.startsWith("#") &&
            !trimmed.startsWith("---")
          );
        });
        const fallbackLine = (firstContentLine?.trim() || "").replace(/\*\*/g, "");
        const preview = getContentPreview(fallbackLine, false);
        return new Text(preview ? `${statusLine}\n${theme.fg("dim", preview)}` : statusLine, 0, 0);
      }

      const preview = getContentPreview(textContent, true);
      return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
    },
  });

  pi.registerTool({
    name: "perplexity-code-search",
    label: "Perplexity Code Search",
    description:
      "Search for programming, API, library, framework, documentation, source-code, GitHub, Stack Overflow, and code-example context using Perplexity AI. Use when the user asks a coding/docs question without providing a specific URL. If a URL is provided, use perplexity-web-fetch. For non-code general/current research, use perplexity-web-search.",
    promptSnippet:
      "Use for programming/API/library/framework/docs/code examples/source-code questions when no specific URL was provided. Use fetch for URLs and web-search for non-code research.",
    parameters: CodeSearchParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const query = params.query.trim();
      if (!query) {
        return {
          content: [{ type: "text", text: "Error: No query provided." }],
          details: { error: "No query provided" } satisfies PerplexityCodeSearchDetails,
        };
      }

      const enhancedQuery = buildCodeSearchQuery(query);
      const options = buildCodeSearchOptions(params.numResults, signal);

      try {
        const { answer, results } = await searchWithPerplexity(enhancedQuery, options);
        const result: QueryResultData = { query, answer, results, error: null };
        const item = buildCodeSearchItem(query, enhancedQuery, result);
        const stored = storeFullContent("code-search", "query", [item], ctx);
        const prepared = prepareOutput(stored.fullContent, stored.responseId, "query", 1);
        const details = withStoredMetadata<PerplexityCodeSearchDetails>(
          {
            query,
            enhancedQuery,
            totalResults: results.length,
          },
          stored,
          prepared,
        );

        return {
          content: [{ type: "text", text: prepared.text }],
          details,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { query, enhancedQuery, error: message } satisfies PerplexityCodeSearchDetails,
        };
      }
    },

    renderCall(args, theme) {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return new Text(
          theme.fg("toolTitle", theme.bold("perplexity code ")) + theme.fg("error", "(no query)"),
          0,
          0,
        );
      }
      const display = query.length > 70 ? query.slice(0, 67) + "..." : query;
      return new Text(
        theme.fg("toolTitle", theme.bold("perplexity code ")) + theme.fg("accent", display),
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as PerplexityCodeSearchDetails | undefined;
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      const baseStatus = theme.fg("success", `${details?.totalResults ?? 0} code/docs sources`);
      const statusLine = appendStoredStatus(baseStatus, details, theme);
      const textContent = result.content.find((c) => c.type === "text")?.text || "";
      const preview = getContentPreview(textContent, expanded);
      return new Text(preview ? `${statusLine}\n${theme.fg("dim", preview)}` : statusLine, 0, 0);
    },
  });

  pi.registerTool({
    name: "perplexity-web-fetch",
    label: "Perplexity Web Fetch",
    description:
      "Read, extract, summarize, or answer questions about specific HTTP/HTTPS URL(s) using Perplexity AI. Use when the user provides URL(s) or asks about specific pages. Not for broad general research (use perplexity-web-search) or programming/docs discovery without a URL (use perplexity-code-search). Multiple URLs run with up to 3 concurrent requests. This Perplexity-only fetcher does not clone GitHub repos, analyze local files/videos, extract video frames, or persist content to disk.",
    promptSnippet:
      "Use when the user provides HTTP/HTTPS URL(s), or asks to read, summarize, extract, or answer questions about specific pages. Pass the user's exact question in prompt.",
    parameters: FetchParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const rawUrlList: unknown[] = Array.isArray(params.urls)
        ? params.urls
        : params.url !== undefined
          ? [params.url]
          : [];
      const urlList = normalizeUrlList(rawUrlList);

      if (urlList.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No valid HTTP/HTTPS URL provided. Use 'url' or 'urls' parameter.",
            },
          ],
          details: {
            error: "No valid HTTP/HTTPS URL provided",
          } satisfies PerplexityWebFetchDetails,
        };
      }

      const options = buildFetchOptions(params.prompt, signal);
      let completed = 0;

      onUpdate?.({
        content: [{ type: "text", text: `Fetching 0/${urlList.length} URLs...` }],
        details: { phase: "fetch", progress: 0, completed, total: urlList.length },
      });

      const fetchResults = await runWithConcurrency(
        urlList,
        CONCURRENCY_LIMIT,
        async (url): Promise<FetchResultData> => {
          try {
            const { content, results } = await fetchUrlWithPerplexity(url, options);
            return { url, content, results, error: null };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { url, content: "", results: [], error: message };
          } finally {
            completed++;
            onUpdate?.({
              content: [{ type: "text", text: `Fetched ${completed}/${urlList.length}: "${url}"` }],
              details: {
                phase: "fetch",
                progress: completed / urlList.length,
                completed,
                total: urlList.length,
                currentUrl: url,
              },
            });
          }
        },
      );

      const items = buildFetchItems(urlList, fetchResults);
      const stored = storeFullContent("fetch", "url", items, ctx);
      const prepared = prepareOutput(stored.fullContent, stored.responseId, "url", items.length);
      const details = withStoredMetadata(
        buildFetchDetails(urlList, fetchResults),
        stored,
        prepared,
      );

      return {
        content: [{ type: "text", text: prepared.text }],
        details,
      };
    },

    renderCall(args, theme) {
      const rawUrlList: unknown[] = Array.isArray(args.urls)
        ? args.urls
        : args.url !== undefined
          ? [args.url]
          : [];
      const urlList = normalizeUrlList(rawUrlList);
      if (urlList.length === 0) {
        return new Text(
          theme.fg("toolTitle", theme.bold("perplexity fetch ")) + theme.fg("error", "(no URL)"),
          0,
          0,
        );
      }
      if (urlList.length === 1) {
        const url = urlList[0] ?? "";
        const display = url.length > 60 ? url.slice(0, 57) + "..." : url;
        return new Text(
          theme.fg("toolTitle", theme.bold("perplexity fetch ")) + theme.fg("accent", display),
          0,
          0,
        );
      }

      const lines = [
        theme.fg("toolTitle", theme.bold("perplexity fetch ")) +
          theme.fg("accent", `${urlList.length} URLs`),
      ];
      for (const url of urlList.slice(0, 5)) {
        const display = url.length > 60 ? url.slice(0, 57) + "..." : url;
        lines.push(theme.fg("muted", "  " + display));
      }
      if (urlList.length > 5) {
        lines.push(theme.fg("muted", `  ... and ${urlList.length - 5} more`));
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as PerplexityWebFetchDetails | undefined;

      if (isPartial) {
        const progress = details?.progress ?? 0;
        const bar =
          "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
        const count =
          details?.completed !== undefined && details?.total !== undefined
            ? `${details.completed}/${details.total}`
            : details?.phase || "fetching";
        return new Text(theme.fg("accent", `[${bar}] ${count}`), 0, 0);
      }

      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      const countColor = (details?.successful ?? 0) > 0 ? "success" : "error";
      const baseStatus =
        theme.fg(countColor, `${details?.successful ?? 0}/${details?.urlCount ?? 0} URLs`) +
        theme.fg("muted", `, ${details?.totalSources ?? 0} sources`);
      const statusLine = appendStoredStatus(baseStatus, details, theme);
      const textContent = result.content.find((c) => c.type === "text")?.text || "";

      if (!expanded) {
        const firstContentLine = textContent.split("\n").find((line) => {
          const trimmed = line.trim();
          return (
            trimmed &&
            !trimmed.startsWith("[") &&
            !trimmed.startsWith("#") &&
            !trimmed.startsWith("---")
          );
        });
        const fallbackLine = (firstContentLine?.trim() || "").replace(/\*\*/g, "");
        const preview = getContentPreview(fallbackLine, false);
        return new Text(preview ? `${statusLine}\n${theme.fg("dim", preview)}` : statusLine, 0, 0);
      }

      const preview = getContentPreview(textContent, true);
      return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
    },
  });

  pi.registerTool({
    name: "perplexity-web-get-content",
    label: "Perplexity Web Get Content",
    description:
      "Retrieve full current-session content previously stored by perplexity-web-search, perplexity-web-fetch, or perplexity-code-search. Use only when a prior result was truncated or when a specific stored query/URL needs to be read in full via responseId.",
    promptSnippet:
      "Use after a Perplexity web access tool returns a responseId, especially when output was truncated and full stored content is needed.",
    parameters: GetContentParams,

    async execute(_toolCallId, params) {
      const entry = storedContent.get(params.responseId);
      if (!entry) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Stored content for responseId "${params.responseId}" is no longer available. It may have been evicted from the in-memory cache or cleared at session shutdown.`,
            },
          ],
          details: {
            responseId: params.responseId,
            error: "Stored content no longer available",
            cacheBytes: storedBytes,
            cacheMaxBytes: MAX_STORED_BYTES,
          } satisfies PerplexityGetContentDetails,
        };
      }

      const queryIndex = getValidIndex(params.queryIndex);
      const urlIndex = getValidIndex(params.urlIndex);
      if (params.queryIndex !== undefined && queryIndex === null) {
        return {
          content: [{ type: "text", text: "Error: queryIndex must be a non-negative integer." }],
          details: buildGetContentErrorDetails(params.responseId, "Invalid queryIndex"),
        };
      }
      if (params.urlIndex !== undefined && urlIndex === null) {
        return {
          content: [{ type: "text", text: "Error: urlIndex must be a non-negative integer." }],
          details: buildGetContentErrorDetails(params.responseId, "Invalid urlIndex"),
        };
      }
      if (queryIndex !== null && urlIndex !== null) {
        return {
          content: [{ type: "text", text: "Error: Use either queryIndex or urlIndex, not both." }],
          details: buildGetContentErrorDetails(params.responseId, "Multiple selectors provided"),
        };
      }

      let text: string;
      let selectedIndex: number | undefined;
      if (queryIndex !== null) {
        if (entry.itemKind !== "query") {
          return {
            content: [
              { type: "text", text: "Error: This stored response does not contain query items." },
            ],
            details: buildGetContentErrorDetails(params.responseId, "Wrong selector type"),
          };
        }
        const item = entry.items[queryIndex];
        if (!item) {
          return {
            content: [
              {
                type: "text",
                text: `Error: queryIndex ${queryIndex} out of range (0-${entry.items.length - 1}).`,
              },
            ],
            details: buildGetContentErrorDetails(params.responseId, "Index out of range"),
          };
        }
        text = item.content;
        selectedIndex = queryIndex;
      } else if (urlIndex !== null) {
        if (entry.itemKind !== "url") {
          return {
            content: [
              { type: "text", text: "Error: This stored response does not contain URL items." },
            ],
            details: buildGetContentErrorDetails(params.responseId, "Wrong selector type"),
          };
        }
        const item = entry.items[urlIndex];
        if (!item) {
          return {
            content: [
              {
                type: "text",
                text: `Error: urlIndex ${urlIndex} out of range (0-${entry.items.length - 1}).`,
              },
            ],
            details: buildGetContentErrorDetails(params.responseId, "Index out of range"),
          };
        }
        text = item.content;
        selectedIndex = urlIndex;
      } else {
        text = joinStoredItems(entry.items);
      }

      const details: PerplexityGetContentDetails = {
        responseId: params.responseId,
        type: entry.type,
        itemKind: entry.itemKind,
        itemCount: entry.items.length,
        byteSize: Buffer.byteLength(text, "utf8"),
        cacheBytes: storedBytes,
        cacheMaxBytes: MAX_STORED_BYTES,
      };
      if (selectedIndex !== undefined) details.selectedIndex = selectedIndex;

      return {
        content: [{ type: "text", text }],
        details,
      };
    },

    renderCall(args, theme) {
      const responseId = typeof args.responseId === "string" ? args.responseId : "";
      const queryIndex =
        typeof args.queryIndex === "number" ? ` queryIndex=${args.queryIndex}` : "";
      const urlIndex = typeof args.urlIndex === "number" ? ` urlIndex=${args.urlIndex}` : "";
      const display = responseId ? responseId.slice(0, 8) : "(no responseId)";
      return new Text(
        theme.fg("toolTitle", theme.bold("perplexity get-content ")) +
          theme.fg(responseId ? "accent" : "error", display + queryIndex + urlIndex),
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as PerplexityGetContentDetails | undefined;
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      const selected =
        details?.selectedIndex !== undefined
          ? ` ${details.itemKind}Index=${details.selectedIndex}`
          : "";
      const baseStatus = theme.fg(
        "success",
        `${details?.type ?? "content"}${selected} (${formatBytes(details?.byteSize ?? 0)})`,
      );
      const statusLine =
        baseStatus +
        theme.fg(
          "muted",
          ` cache ${formatBytes(details?.cacheBytes ?? 0)}/${formatBytes(details?.cacheMaxBytes ?? MAX_STORED_BYTES)}`,
        );
      const textContent = result.content.find((c) => c.type === "text")?.text || "";
      if (!expanded) return new Text(statusLine, 0, 0);
      const preview = getContentPreview(textContent, true);
      return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
    },
  });
}
