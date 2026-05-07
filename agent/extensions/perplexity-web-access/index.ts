import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

interface SearchResult {
  title: string;
  url: string;
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

interface PerplexityApiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: unknown[];
}

const SearchParams = Type.Object({
  query: Type.Optional(
    Type.String({
      description: "Single general web search query.",
    }),
  ),
  queries: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Multiple general web research queries searched with up to 3 concurrent requests, with synthesized answers saved to the Markdown output file. Prefer this for broad research — vary phrasing, scope, and angle across 2-4 queries. Good: ['React vs Vue performance benchmarks 2026', 'React vs Vue developer experience comparison', 'React ecosystem size vs Vue ecosystem']. Bad: ['React vs Vue', 'React vs Vue comparison', 'React vs Vue review'] (too similar, redundant results).",
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

function validateDomainFilter(domains: string[]): string[] {
  return domains.filter((d) => {
    const domain = d.startsWith("-") ? d.slice(1) : d;
    return /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/.test(domain);
  });
}

async function searchWithPerplexity(
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
      results.push({ title: `Source ${i + 1}`, url: citation });
    } else if (citation && typeof citation === "object") {
      const url = "url" in citation ? citation.url : undefined;
      if (typeof url !== "string") continue;
      const title =
        "title" in citation && typeof citation.title === "string"
          ? citation.title
          : `Source ${i + 1}`;
      results.push({ title, url });
    }
  }

  return { answer, results };
}

interface QueryResultData {
  query: string;
  answer: string;
  results: SearchResult[];
  error: string | null;
}

interface PerplexityWebSearchDetails {
  queryCount?: number;
  successfulQueries?: number;
  totalResults?: number;
  error?: string;
  phase?: string;
  progress?: number;
  completed?: number;
  total?: number;
  outputPath?: string;
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

function formatSearchSummary(results: SearchResult[], answer: string): string {
  let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
  output += results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
  return output;
}

function formatSearchItem(result: QueryResultData, includeHeader: boolean): string {
  let output = includeHeader ? `## Query: "${result.query}"\n\n` : "";

  if (result.error) output += `Error: ${result.error}`;
  else if (result.results.length === 0) output += "No results found.";
  else output += formatSearchSummary(result.results, result.answer);

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

function buildDetails(results: QueryResultData[], outputPath: string): PerplexityWebSearchDetails {
  return {
    outputPath,
    queryCount: results.length,
    successfulQueries: results.filter((r) => !r.error).length,
    totalResults: results.reduce((sum, r) => sum + r.results.length, 0),
  };
}

export default function PerplexityWebAccess(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "perplexity-web-search",
    label: "Perplexity Web Search",
    description:
      "Search the general web using Perplexity AI for current facts, news, comparisons, and broad research. Saves synthesized answers with citations to a Markdown file in /tmp and returns the file path. Multiple queries run with up to 3 concurrent requests.",
    promptSnippet:
      "Use for general/current web research, news, comparisons, and broad facts. Prefer {queries:[...]} with 2-4 varied angles. Read the returned Markdown file path for results.",
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
              },
            });
          }
        },
      );

      const outputPath = await saveMarkdownOutput(buildSearchOutput(searchResults));

      return {
        content: [{ type: "text", text: outputPath }],
        details: buildDetails(searchResults, outputPath),
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
      const statusLine = theme.fg("success", `${queryInfo}${details?.totalResults ?? 0} sources`);
      const outputPath =
        details?.outputPath || result.content.find((c) => c.type === "text")?.text || "";
      const pathLine = outputPath ? theme.fg("dim", outputPath) : theme.fg("dim", "No output file");

      return new Text(statusLine + "\n" + pathLine, 0, 0);
    },
  });
}
