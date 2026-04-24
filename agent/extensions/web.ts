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
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_TOKENS = 20000;
const DEFAULT_MAX_TOKENS_PER_PAGE = 4096;
const WEB_FETCH_PRESET = "pro-search";

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
  return `[${index + 1}] ${page.title}\n${page.url}\n${metaLine}page extract: ${page.snippet}`;
}

function formatSearchContext(query: string, pages: SearchCreateResponse.Result[]): string {
  const renderedResults =
    pages.length > 0 ? pages.map(formatSearchResult).join("\n\n") : "No results returned.";

  return `Perplexity web search context for: ${query}\n\nUse the numbered results below as external context and cite URLs when relevant.\nThe page extract text comes from Perplexity Search API snippet extraction, not a separate browser fetch performed by this tool.\n\n${renderedResults}`;
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

function buildFetchInput(url: URL): string {
  return [
    "Fetch the exact URL below and return the page content as useful context for a coding agent.",
    `URL: ${url.toString()}`,
    "",
    "Requirements:",
    "- Use only the fetch_url tool.",
    "- Do not run a web search.",
    "- Do not fetch any other URL.",
    "- Preserve headings, API names, configuration keys, commands, and code examples when relevant.",
    "- If the page cannot be fetched, explain the failure briefly.",
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
  url: string,
  response: ResponseCreateResponse,
  fetchedContents: FetchedUrlContent[],
): string {
  const fetchedSection =
    fetchedContents.length > 0
      ? fetchedContents.map(formatFetchedUrlContent).join("\n\n")
      : "No fetch_url_results content returned.";
  const responseText = extractResponseText(response);
  const responseSection = responseText ? `\n\nPerplexity pro-search response:\n\n${responseText}` : "";

  return `Perplexity pro-search web fetch context for URL: ${url}\n\nUse the fetched content below as external context and cite URLs when relevant.\nThe page extract text comes from Perplexity Agent API fetch_url using the pro-search preset.\n\nFetched content:\n\n${fetchedSection}${responseSection}`;
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
      "If one query is unlikely to be enough, run multiple targeted searches that cover different interpretations or subtopics, then synthesize the results.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    execute: async (_toolCallId, params, signal) => {
      const query = params.query.trim();

      if (!query) {
        throw new Error("query must not be empty");
      }

      const payload: SearchCreateParams = {
        query,
        max_results: DEFAULT_MAX_RESULTS,
        max_tokens: DEFAULT_MAX_TOKENS,
        max_tokens_per_page: DEFAULT_MAX_TOKENS_PER_PAGE,
        search_language_filter: ["en"],
      };

      const result = await getClient().search.create(payload, { signal });

      return {
        content: [
          {
            type: "text",
            text: formatSearchContext(query, result.results),
          },
        ],
        details: {
          query,
          resultCount: result.results.length,
        },
      };
    },
    renderCall(args, theme, _context) {
      return new Text(
        theme.fg("toolTitle", theme.bold("web_search ")) + theme.fg("accent", `"${args.query}"`),
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Perplexity Web Fetch",
    description:
      "Fetch a specific HTTP(S) URL provided by the user using Perplexity pro-search and return the fetched page context.",
    promptSnippet:
      "Fetch a specific URL with web_fetch when the user provides an explicit URL to read, inspect, check, or use as documentation/context.",
    promptGuidelines: [
      "Use this tool when the user provides a URL and asks you to read, inspect, check, search at, or use that page as context.",
      "Use web_search instead when the user asks to discover pages or search the web without a specific URL.",
      "Prefer web_fetch over web_search when the user gave an exact URL, unless fetching fails or additional sources are needed.",
      "Only fetch URLs that the user provided or clearly asked you to open.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Absolute http:// or https:// URL to fetch" }),
    }),
    execute: async (_toolCallId, params, signal) => {
      const url = normalizeFetchUrl(params.url);
      const payload: ResponseCreateParamsNonStreaming = {
        preset: WEB_FETCH_PRESET,
        input: buildFetchInput(url),
        max_steps: 1,
        tools: [{ type: "fetch_url", max_urls: 1 }],
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
            text: formatFetchContext(url.toString(), result, fetchedContents),
          },
        ],
        details: {
          url: url.toString(),
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
      return new Text(
        theme.fg("toolTitle", theme.bold("web_fetch ")) + theme.fg("accent", `"${args.url}"`),
        0,
        0,
      );
    },
  });
}
