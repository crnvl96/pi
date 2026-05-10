import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readability } from "@mozilla/readability";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { parseHTML } from "linkedom";
import { Type } from "typebox";
import TurndownService from "turndown";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const SEARCH_PROVIDER = "perplexity";
const DEFAULT_NUM_RESULTS = 5;
const MAX_NUM_RESULTS = 20;
const FETCH_TIMEOUT_MS = 30000;

const RATE_LIMIT = {
  maxRequests: 10,
  windowMs: 60 * 1000,
};

const requestTimestamps: number[] = [];

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchResponse {
  answer: string;
  results: SearchResult[];
}

interface SearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  signal?: AbortSignal;
}

interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  error: string | null;
}

interface TruncatedOutputDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

interface WebSearchDetails extends TruncatedOutputDetails {
  queries: string[];
  queryCount: number;
  successfulQueries: number;
  totalResults: number;
  fetchedUrls: number;
  sourceUrls: string[];
  error?: string;
}

interface FetchContentDetails extends TruncatedOutputDetails {
  urls: string[];
  urlCount: number;
  successful: number;
  totalChars: number;
  error?: string;
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getApiKey(): string {
  const key = normalizeApiKey(process.env.PERPLEXITY_API_KEY);
  if (!key) {
    throw new Error(
      "Perplexity API key not found. Set PERPLEXITY_API_KEY environment variable. " +
        "Get a key at https://perplexity.ai/settings/api",
    );
  }
  return key;
}

function checkRateLimit(): void {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.windowMs;

  while (requestTimestamps.length > 0 && requestTimestamps[0] < windowStart) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= RATE_LIMIT.maxRequests) {
    const waitMs = requestTimestamps[0] + RATE_LIMIT.windowMs - now;
    throw new Error(`Rate limited. Try again in ${Math.ceil(waitMs / 1000)}s`);
  }

  requestTimestamps.push(now);
}

function validateDomainFilter(domains: string[]): string[] {
  return domains.filter((d) => {
    const domain = d.startsWith("-") ? d.slice(1) : d;
    return /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/.test(domain);
  });
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
    if (trimmed.length > 0) normalized.push(trimmed);
  }
  return normalized;
}

function extractHeadingTitle(text: string): string | null {
  const match = text.match(/^#{1,2}\s+(.+)/m);
  if (!match) return null;
  const cleaned = match[1].replace(/\*+/g, "").trim();
  return cleaned || null;
}

function extractTextTitle(text: string, url: string): string {
  try {
    return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
  } catch {
    return url;
  }
}

function isLikelyJSRendered(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;

  const bodyHtml = bodyMatch[1];
  const textContent = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const scriptCount = (html.match(/<script/gi) || []).length;
  return textContent.length < 500 && scriptCount > 3;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchWithPerplexity(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  checkRateLimit();

  const apiKey = getApiKey();
  const numResults = Math.min(options.numResults ?? DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS);

  const requestBody: Record<string, unknown> = {
    model: "sonar-pro",
    messages: [{ role: "user", content: query }],
    max_tokens: 32768,
    return_related_questions: false,
  };

  if (options.recencyFilter) {
    requestBody.search_recency_filter = options.recencyFilter;
  }

  if (options.domainFilter && options.domainFilter.length > 0) {
    const validated = validateDomainFilter(options.domainFilter);
    if (validated.length > 0) {
      requestBody.search_domain_filter = validated;
    }
  }

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${errorText}`);
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Perplexity API returned invalid JSON: ${message}`);
  }

  const answer =
    (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || "";
  const citations = Array.isArray(data.citations) ? data.citations : [];

  const results: SearchResult[] = [];
  for (let i = 0; i < Math.min(citations.length, numResults); i++) {
    const citation = citations[i] as unknown;
    if (typeof citation === "string") {
      results.push({ title: `Source ${i + 1}`, url: citation, snippet: "" });
    } else if (
      citation &&
      typeof citation === "object" &&
      typeof (citation as { url?: unknown }).url === "string"
    ) {
      const c = citation as { title?: string; url: string };
      results.push({
        title: c.title || `Source ${i + 1}`,
        url: c.url,
        snippet: "",
      });
    }
  }

  return { answer, results };
}

async function extractViaHttp(url: string, signal?: AbortSignal): Promise<ExtractedContent> {
  try {
    new URL(url);
  } catch {
    return { url, title: "", content: "", error: "Invalid URL" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    if (!response.ok) {
      return {
        url,
        title: "",
        content: "",
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (
      contentType.includes("application/octet-stream") ||
      contentType.includes("image/") ||
      contentType.includes("audio/") ||
      contentType.includes("video/") ||
      contentType.includes("application/zip")
    ) {
      return {
        url,
        title: "",
        content: "",
        error: `Unsupported content type: ${contentType.split(";")[0]}`,
      };
    }

    const text = await response.text();
    const isHTML =
      contentType.includes("text/html") || contentType.includes("application/xhtml+xml");

    if (!isHTML) {
      const title = extractTextTitle(text, url);
      return { url, title, content: text, error: null };
    }

    const { document } = parseHTML(text);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article) {
      const fallbackText = htmlToText(text);
      const title = extractTextTitle(fallbackText, url);
      if (fallbackText) return { url, title, content: fallbackText, error: null };
      return {
        url,
        title: "",
        content: "",
        error: isLikelyJSRendered(text)
          ? "Page appears to be JavaScript-rendered (content loads dynamically)"
          : "Could not extract readable content from HTML structure",
      };
    }

    const markdown = turndown.turndown(article.content ?? "");
    return { url, title: article.title || "", content: markdown, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, title: "", content: "", error: message };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function extractContent(url: string, signal?: AbortSignal): Promise<ExtractedContent> {
  const direct = await extractViaHttp(url, signal);
  if (!direct.error) return direct;

  try {
    const fallback = await searchWithPerplexity(
      `Extract the main readable content from this URL. Return as much of the page content as possible, preserving important details and source links. URL: ${url}`,
      { numResults: DEFAULT_NUM_RESULTS, signal },
    );
    if (!fallback.answer) return direct;

    let content = fallback.answer;
    if (fallback.results.length > 0) {
      content += "\n\n## Perplexity sources\n\n";
      for (let i = 0; i < fallback.results.length; i++) {
        const result = fallback.results[i];
        content += `${i + 1}. ${result.title}\n   ${result.url}\n`;
      }
    }

    return {
      url,
      title: `${url} (via Perplexity)`,
      content,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...direct, error: `${direct.error}\nPerplexity fallback failed: ${message}` };
  }
}

async function fetchAllContent(urls: string[], signal?: AbortSignal): Promise<ExtractedContent[]> {
  return Promise.all(urls.map((url) => extractContent(url, signal)));
}

function uniqueUrls(results: SearchResult[]): string[] {
  const urls: string[] = [];
  for (const result of results) {
    if (!urls.includes(result.url)) urls.push(result.url);
  }
  return urls;
}

function formatSearchOutput(
  items: Array<{
    query: string;
    answer: string;
    results: SearchResult[];
    fetched: ExtractedContent[];
    error: string | null;
  }>,
): string {
  let output = "";
  for (const item of items) {
    output += `# Search: ${item.query}\n\n`;
    if (item.error) {
      output += `Error: ${item.error}\n\n`;
      continue;
    }

    output += `## Perplexity answer\n\n${item.answer || "No answer returned."}\n\n`;
    output += "## Raw sources\n\n";
    if (item.results.length === 0) {
      output += "No sources returned.\n\n";
    } else {
      for (let i = 0; i < item.results.length; i++) {
        const result = item.results[i];
        output += `${i + 1}. ${result.title}\n   ${result.url}\n`;
      }
      output += "\n";
    }

    output += "## Fetched source content\n\n";
    for (const fetched of item.fetched) {
      output += `### ${fetched.title || fetched.url}\n\n`;
      output += `Source: ${fetched.url}\n\n`;
      if (fetched.error) {
        output += `Error: ${fetched.error}\n\n`;
      } else {
        output += `${fetched.content}\n\n`;
      }
    }
  }
  return output.trim();
}

function formatFetchOutput(results: ExtractedContent[]): string {
  let output = "# Fetched content\n\n";
  for (const result of results) {
    output += `## ${result.title || result.url}\n\n`;
    output += `Source: ${result.url}\n\n`;
    if (result.error) {
      output += `Error: ${result.error}\n\n`;
    } else {
      output += `${result.content}\n\n`;
    }
  }
  return output.trim();
}

async function truncateForTool(
  output: string,
  filePrefix: string,
): Promise<{ text: string; details: TruncatedOutputDetails }> {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  const details: TruncatedOutputDetails = { truncation };
  let resultText = truncation.content;

  if (truncation.truncated) {
    const tempDir = await mkdtemp(join(tmpdir(), filePrefix));
    const tempFile = join(tempDir, "output.md");
    await withFileMutationQueue(tempFile, async () => {
      await writeFile(tempFile, output, "utf8");
    });

    details.fullOutputPath = tempFile;

    const truncatedLines = truncation.totalLines - truncation.outputLines;
    const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
    resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
    resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
    resultText += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
    resultText += ` Full output saved to: ${tempFile}.`;
    resultText += ` The agent may access the full returned content with read({ path: "${tempFile}" }).]`;
  }

  return { text: resultText, details };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: `Search the web using ${SEARCH_PROVIDER} only. Returns raw Perplexity results and always fetches the content of returned source pages. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; full output is saved to a temp file if truncated.`,
    promptSnippet: `Use for web research. This ${SEARCH_PROVIDER}-only web_search returns raw results plus fetched source page content.`,
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ description: "Single search query. For broad research, prefer queries." }),
      ),
      queries: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Multiple search queries. Each query is searched and its source pages are fetched.",
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
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const rawQueryList: unknown[] = Array.isArray(params.queries)
        ? params.queries
        : params.query !== undefined
          ? [params.query]
          : [];
      const queryList = normalizeQueryList(rawQueryList);

      if (queryList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No query provided. Use query or queries." }],
          details: {
            error: "No query provided",
            queries: [],
            queryCount: 0,
            successfulQueries: 0,
            totalResults: 0,
            fetchedUrls: 0,
            sourceUrls: [],
          } satisfies WebSearchDetails,
        };
      }

      const items: Array<{
        query: string;
        answer: string;
        results: SearchResult[];
        fetched: ExtractedContent[];
        error: string | null;
      }> = [];
      let totalResults = 0;
      let fetchedUrls = 0;

      for (let i = 0; i < queryList.length; i++) {
        const query = queryList[i];
        onUpdate?.({
          content: [{ type: "text", text: `Searching ${i + 1}/${queryList.length}: ${query}` }],
          details: { phase: "search", progress: i / queryList.length, currentQuery: query },
        });

        try {
          const search = await searchWithPerplexity(query, {
            numResults: params.numResults,
            recencyFilter: params.recencyFilter,
            domainFilter: params.domainFilter,
            signal,
          });
          const urls = uniqueUrls(search.results);
          totalResults += search.results.length;

          onUpdate?.({
            content: [
              { type: "text", text: `Fetching ${urls.length} source page(s) for: ${query}` },
            ],
            details: {
              phase: "fetch",
              progress: (i + 0.5) / queryList.length,
              currentQuery: query,
            },
          });

          const fetched = await fetchAllContent(urls, signal);
          fetchedUrls += fetched.length;
          items.push({
            query,
            answer: search.answer,
            results: search.results,
            fetched,
            error: null,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          items.push({ query, answer: "", results: [], fetched: [], error: message });
        }
      }

      const output = formatSearchOutput(items);
      const truncated = await truncateForTool(output, "pi-web-search-");
      const successfulQueries = items.filter((item) => !item.error).length;
      const sourceUrls = uniqueUrls(items.flatMap((item) => item.results));

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          queries: queryList,
          queryCount: queryList.length,
          successfulQueries,
          totalResults,
          fetchedUrls,
          sourceUrls,
          ...truncated.details,
        } satisfies WebSearchDetails,
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
          theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"),
          0,
          0,
        );
      }
      if (queryList.length === 1) {
        const display = queryList[0].length > 60 ? queryList[0].slice(0, 57) + "..." : queryList[0];
        return new Text(
          theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`),
          0,
          0,
        );
      }
      return new Text(
        theme.fg("toolTitle", theme.bold("search ")) +
          theme.fg("accent", `${queryList.length} queries`),
        0,
        0,
      );
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as WebSearchDetails | undefined;
      if (isPartial) {
        return new Text(theme.fg("accent", "searching/fetching sources..."), 0, 0);
      }
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }
      let text = theme.fg(
        "success",
        `${details?.successfulQueries ?? 0}/${details?.queryCount ?? 0} queries, ${details?.totalResults ?? 0} sources, ${details?.fetchedUrls ?? 0} pages fetched`,
      );
      if (details?.truncation?.truncated) text += theme.fg("warning", " (truncated)");

      const sourceUrls = details?.sourceUrls ?? [];
      if (sourceUrls.length > 0) {
        text += "\n" + sourceUrls.map((url, i) => theme.fg("dim", `${i + 1}. ${url}`)).join("\n");
      }

      if (expanded) {
        const content = result.content.find((c) => c.type === "text")?.text || "";
        text += "\n" + theme.fg("dim", content.slice(0, 1000));
        if (details?.fullOutputPath) {
          text +=
            "\n" +
            theme.fg(
              "dim",
              `Full output: ${details.fullOutputPath} (use read({ path: "${details.fullOutputPath}" }) for full returned content)`,
            );
        }
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description: `Fetch URL(s) and extract readable content as markdown, with Perplexity fallback when direct extraction fails. Always fetches page content. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; full output is saved to a temp file if truncated.`,
    promptSnippet:
      "Use to fetch full page content from URL(s), with Perplexity fallback for blocked pages.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
      urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs to fetch" })),
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const urlList = normalizeUrlList(params.urls ?? (params.url ? [params.url] : []));
      if (urlList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No URL provided." }],
          details: {
            urls: [],
            urlCount: 0,
            successful: 0,
            totalChars: 0,
            error: "No URL provided",
          } satisfies FetchContentDetails,
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${urlList.length} URL(s)...` }],
        details: { phase: "fetch", progress: 0 },
      });

      const results = await fetchAllContent(urlList, signal);
      const successful = results.filter((result) => !result.error).length;
      const totalChars = results.reduce((sum, result) => sum + result.content.length, 0);
      const output = formatFetchOutput(results);
      const truncated = await truncateForTool(output, "pi-fetch-content-");

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          urls: urlList,
          urlCount: urlList.length,
          successful,
          totalChars,
          ...truncated.details,
        } satisfies FetchContentDetails,
      };
    },

    renderCall(args, theme) {
      const urlList = normalizeUrlList(args.urls ?? (args.url ? [args.url] : []));
      if (urlList.length === 0) {
        return new Text(
          theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no URL)"),
          0,
          0,
        );
      }
      if (urlList.length === 1) {
        const display = urlList[0].length > 60 ? urlList[0].slice(0, 57) + "..." : urlList[0];
        return new Text(
          theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display),
          0,
          0,
        );
      }
      return new Text(
        theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", `${urlList.length} URLs`),
        0,
        0,
      );
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as FetchContentDetails | undefined;
      if (isPartial) {
        return new Text(theme.fg("accent", "fetching..."), 0, 0);
      }
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }
      const countColor = (details?.successful ?? 0) > 0 ? "success" : "error";
      let text =
        theme.fg(countColor, `${details?.successful ?? 0}/${details?.urlCount ?? 0} URLs`) +
        theme.fg("muted", ` (${details?.totalChars ?? 0} chars)`);
      if (details?.truncation?.truncated) text += theme.fg("warning", " (truncated)");
      if (expanded) {
        const content = result.content.find((c) => c.type === "text")?.text || "";
        text += "\n" + theme.fg("dim", content.slice(0, 1000));
        if (details?.fullOutputPath) {
          text +=
            "\n" +
            theme.fg(
              "dim",
              `Full output: ${details.fullOutputPath} (use read({ path: "${details.fullOutputPath}" }) for full returned content)`,
            );
        }
      }
      return new Text(text, 0, 0);
    },
  });
}
