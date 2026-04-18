import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FetchOptions, FetchResponse, SearchOptions, SearchResponse, SearchResult } from "./types.js";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

const RATE_LIMIT = {
  maxRequests: 10,
  windowMs: 60 * 1000,
};

const requestTimestamps: number[] = [];

interface WebSearchConfig {
  perplexityApiKey?: unknown;
}

interface PerplexityApiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: unknown[];
}

let cachedConfig: WebSearchConfig | null = null;

function loadConfig(): WebSearchConfig {
  if (cachedConfig) return cachedConfig;
  if (!existsSync(CONFIG_PATH)) {
    cachedConfig = {};
    return cachedConfig;
  }

  const content = readFileSync(CONFIG_PATH, "utf-8");
  try {
    cachedConfig = JSON.parse(content) as WebSearchConfig;
    return cachedConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
  }
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getApiKey(): string {
  const config = loadConfig();
  const key =
    normalizeApiKey(process.env["PERPLEXITY_API_KEY"]) ?? normalizeApiKey(config.perplexityApiKey);
  if (!key) {
    throw new Error(
      "Perplexity API key not found. Either:\n" +
        `  1. Create ${CONFIG_PATH} with { "perplexityApiKey": "your-key" }\n` +
        "  2. Set PERPLEXITY_API_KEY environment variable\n" +
        "Get a key at https://perplexity.ai/settings/api",
    );
  }
  return key;
}

function checkRateLimit(): void {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.windowMs;

  while ((requestTimestamps[0] ?? Infinity) < windowStart) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= RATE_LIMIT.maxRequests) {
    const oldestTimestamp = requestTimestamps[0];
    if (oldestTimestamp === undefined) return;
    const waitMs = oldestTimestamp + RATE_LIMIT.windowMs - now;
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

export function isPerplexityAvailable(): boolean {
  const config = loadConfig();
  return !!(
    normalizeApiKey(process.env["PERPLEXITY_API_KEY"]) ?? normalizeApiKey(config.perplexityApiKey)
  );
}

function buildFetchQuery(url: string, prompt?: string): string {
  const normalizedPrompt = prompt?.trim();
  if (normalizedPrompt) {
    return [
      "Using the content available at this URL, answer the user's request in clear markdown.",
      "Include important details, preserve source attribution, and cite source URLs when relevant.",
      "If the page cannot be fully accessed, say what is unavailable instead of inventing details.",
      "",
      `User request: ${normalizedPrompt}`,
      "",
      `URL: ${url}`,
    ].join("\n");
  }

  return [
    "Fetch and extract the readable content from this URL as markdown.",
    "Preserve the title, key facts, important details, and source attribution.",
    "If the page cannot be fully accessed, summarize the accessible content and say what is unavailable.",
    "",
    `URL: ${url}`,
  ].join("\n");
}

export async function searchWithPerplexity(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  checkRateLimit();

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

export async function fetchUrlWithPerplexity(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResponse> {
  const query = buildFetchQuery(url, options.prompt);
  const searchOptions: SearchOptions = {};
  if (options.signal) searchOptions.signal = options.signal;

  const { answer, results } = await searchWithPerplexity(query, searchOptions);
  return { content: answer, results };
}
